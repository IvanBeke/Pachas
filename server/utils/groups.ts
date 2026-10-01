import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { runtimeDb as db } from "./client";
import {
  categories,
  expenseSplits,
  expenses,
  groupMembers,
  groups,
  recurringExpenses,
  settlementAllocations,
  settlements,
  users,
} from "../db/schema";
import { publicUser, type DbUser } from "./auth";
import { GroupRole } from "../../shared/group-roles";
import { canGroupAction } from "./group-permissions";
import {
  lockGroup,
  writeTransaction,
  type DbTransaction,
} from "./sqlite-writes";
import {
  allocatePayment,
  balancesFromPairwiseDebts,
  buildPairwiseDebts,
  suggestPairwiseTransfers,
  suggestSimplifiedTransfers,
  type PairwiseDebt,
} from "./settlement-ledger";

export interface GroupMember {
  userId: string;
  role: GroupRole;
}

export interface PublicGroup {
  id: string;
  name: string;
  emoji: string | null;
  baseCurrency: string;
  simplifyTransfers: boolean;
  memberIds: string[];
  members: GroupMember[];
  createdBy: string | null;
  createdAt: number;
}

type GroupRow = typeof groups.$inferSelect;
type QueryExecutor = typeof db | DbTransaction;

interface PairwiseLedger {
  debts: PairwiseDebt[];
  balances: Balance[];
  simplifyTransfers: boolean;
  memberIds: string[];
}

async function loadPairwiseLedger(
  gid: string,
  executor: QueryExecutor = db,
  groupRow?: GroupRow,
): Promise<PairwiseLedger> {
  const query = executor as typeof db;
  const [expenseRows, allocationRows, settlementRows, members, row] = await Promise.all([
    query
      .select({ id: expenses.id, paidBy: expenses.paidBy })
      .from(expenses)
      .where(eq(expenses.groupId, gid)),
    query
      .select({
        debtorId: settlementAllocations.debtorId,
        creditorId: settlementAllocations.creditorId,
        amount: settlementAllocations.amount,
      })
      .from(settlementAllocations)
      .innerJoin(
        settlements,
        eq(settlementAllocations.settlementId, settlements.id),
      )
      .where(eq(settlements.groupId, gid)),
    query
      .select({ fromUser: settlements.fromUser, toUser: settlements.toUser })
      .from(settlements)
      .where(eq(settlements.groupId, gid)),
    query
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, gid)),
    groupRow
      ? Promise.resolve([groupRow])
      : query.select().from(groups).where(eq(groups.id, gid)).limit(1),
  ]);
  const eids = expenseRows.map((expense) => expense.id);
  const splitRows = eids.length
    ? await query
        .select({ expenseId: expenseSplits.expenseId, userId: expenseSplits.userId, amount: expenseSplits.amount })
        .from(expenseSplits)
        .where(inArray(expenseSplits.expenseId, eids))
    : [];
  const splitsByExpense = new Map<string, Record<string, number>>();
  for (const split of splitRows) {
    const splits = splitsByExpense.get(split.expenseId) ?? {};
    splits[split.userId] = split.amount;
    splitsByExpense.set(split.expenseId, splits);
  }
  const debts = buildPairwiseDebts(
    expenseRows.map((expense) => ({
      paidBy: expense.paidBy,
      splits: splitsByExpense.get(expense.id) ?? {},
    })),
    allocationRows,
  );
  const balanceMap = new Map(
    balancesFromPairwiseDebts(debts).map((balance) => [balance.memberId, balance.amount]),
  );
  for (const expense of expenseRows) {
    if (!balanceMap.has(expense.paidBy)) balanceMap.set(expense.paidBy, 0);
  }
  for (const split of splitRows) {
    if (!balanceMap.has(split.userId)) balanceMap.set(split.userId, 0);
  }
  for (const settlement of settlementRows) {
    if (!balanceMap.has(settlement.fromUser)) balanceMap.set(settlement.fromUser, 0);
    if (!balanceMap.has(settlement.toUser)) balanceMap.set(settlement.toUser, 0);
  }
  for (const allocation of allocationRows) {
    if (!balanceMap.has(allocation.debtorId)) balanceMap.set(allocation.debtorId, 0);
    if (!balanceMap.has(allocation.creditorId)) balanceMap.set(allocation.creditorId, 0);
  }
  for (const member of members) {
    if (!balanceMap.has(member.userId)) balanceMap.set(member.userId, 0);
  }
  const balances = [...balanceMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([memberId, amount]) => ({ memberId, amount }));
  return {
    debts,
    balances,
    simplifyTransfers: row[0]?.simplifyTransfers ?? true,
    memberIds: members.map((member) => member.userId),
  };
}

function transfersForLedger(ledger: PairwiseLedger): SuggestedTransfer[] {
  return ledger.simplifyTransfers
    ? suggestSimplifiedTransfers(ledger.debts)
    : suggestPairwiseTransfers(ledger.debts);
}

function toPublicGroup(row: GroupRow, members: GroupMember[]): PublicGroup {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    baseCurrency: row.baseCurrency,
    simplifyTransfers: row.simplifyTransfers,
    memberIds: members.map((member) => member.userId),
    members,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

async function membersByGroup(
  gids: string[],
): Promise<Record<string, GroupMember[]>> {
  if (!gids.length) return {};
  const rows = await db
    .select()
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, gids));
  const map: Record<string, GroupMember[]> = {};
  gids.forEach((id) => {
    map[id] = [];
  });
  rows.forEach((r) => {
    (map[r.groupId] ||= []).push({ userId: r.userId, role: r.role });
  });
  return map;
}

export async function getGroupsForUser(
  uid: string,
): Promise<PublicGroup[]> {
  const mine = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, uid));
  if (!mine.length) return [];
  const ids = mine.map((r) => r.groupId);
  const rows = await db
    .select()
    .from(groups)
    .where(inArray(groups.id, ids))
    .orderBy(desc(groups.createdAt));
  const members = await membersByGroup(ids);
  return rows.map((g) => toPublicGroup(g, members[g.id] || []));
}

export async function getGroupById(gid: string): Promise<PublicGroup | null> {
  const rows = await db.select().from(groups).where(eq(groups.id, gid)).limit(1);
  if (!rows[0]) return null;
  const members = await membersByGroup([gid]);
  return toPublicGroup(rows[0], members[gid] || []);
}

export async function requireMember(
  gid: string,
  uid: string,
): Promise<PublicGroup> {
  const group = await getGroupById(gid);
  if (!group) throw createError({ statusCode: 404, message: "not_found" });
  if (group.memberIds.indexOf(uid) === -1) {
    throw createError({ statusCode: 403, message: "not_a_member" });
  }
  return group;
}

export async function getUsersByIds(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.select().from(users).where(inArray(users.id, ids));
  return rows.map((row: DbUser) => publicUser(row));
}

export async function createGroup(
  name: string,
  emoji: string,
  baseCurrency: string,
  creatorId: string,
  memberIds: string[],
): Promise<PublicGroup | null> {
  const gid = randomUUID();
  const now = Date.now();
  const members = Array.from(new Set([creatorId, ...memberIds]));
  await writeTransaction(async (tx) => {
    await tx.insert(groups).values({
      id: gid,
      name,
      emoji,
      baseCurrency,
      createdBy: creatorId,
      createdAt: now,
    });
    for (const uid of members) {
      await tx
        .insert(groupMembers)
        .values({
          groupId: gid,
          userId: uid,
          role: uid === creatorId ? GroupRole.Creator : GroupRole.Member,
        })
        .onConflictDoNothing();
    }
  });
  return getGroupById(gid);
}

export async function addGroupMember(
  gid: string,
  uid: string,
  actorId: string,
): Promise<PublicGroup | null> {
  await writeTransaction(async (tx) => {
    const row = await lockGroup(tx, gid);
    const memberRows = await tx
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, gid));
    const group = toPublicGroup(
      row,
      memberRows.map((member) => ({ userId: member.userId, role: member.role })),
    );
    if (!canGroupAction({ id: actorId }, group, "member.add")) {
      throw createError({ statusCode: 403, message: "forbidden" });
    }
    await tx
      .insert(groupMembers)
      .values({ groupId: gid, userId: uid, role: GroupRole.Member })
      .onConflictDoNothing();
  });
  return getGroupById(gid);
}

export async function removeGroupMember(
  gid: string,
  uid: string,
  actorId: string,
): Promise<PublicGroup | null> {
  await writeTransaction(async (tx) => {
    const row = await lockGroup(tx, gid);
    const memberRows = await tx
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, gid));
    const group = toPublicGroup(
      row,
      memberRows.map((member) => ({ userId: member.userId, role: member.role })),
    );
    if (!canGroupAction({ id: actorId }, group, { type: "member.remove", targetUserId: uid })) {
      if (
        uid === actorId &&
        group.members.find((member) => member.userId === actorId)?.role ===
          GroupRole.Creator
      ) {
        throw createError({ statusCode: 400, message: "cannot_remove_self" });
      }
      throw createError({ statusCode: 403, message: "forbidden" });
    }
    const ledger = await loadPairwiseLedger(gid, tx, row);
    if (
      transfersForLedger(ledger).some(
        (transfer) => transfer.from === uid || transfer.to === uid,
      )
    ) {
      throw createError({
        statusCode: 409,
        message: "member_has_outstanding_payments",
      });
    }
    const removed = await tx
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, gid),
          eq(groupMembers.userId, uid),
          ne(groupMembers.role, GroupRole.Creator),
        ),
      )
      .returning({ userId: groupMembers.userId });
    if (!removed.length) {
      throw createError({ statusCode: 409, message: "member_changed" });
    }
  });
  return getGroupById(gid);
}

export async function changeGroupMemberRole(
  gid: string,
  targetUserId: string,
  role: GroupRole,
  actorId: string,
): Promise<PublicGroup | null> {
  await writeTransaction(async (tx) => {
    const row = await lockGroup(tx, gid);
    const memberRows = await tx
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, gid));
    const group = toPublicGroup(
      row,
      memberRows.map((member) => ({ userId: member.userId, role: member.role })),
    );
    if (
      !canGroupAction(
        { id: actorId },
        group,
        { type: "member.role.change", targetUserId, role },
      )
    ) {
      throw createError({ statusCode: 403, message: "forbidden" });
    }

    if (role === GroupRole.Creator) {
      const currentCreatorId = group.members.find(
        (member) => member.role === GroupRole.Creator,
      )?.userId;
      if (!currentCreatorId) {
        throw createError({ statusCode: 409, message: "creator_missing" });
      }
      const demoted = await tx
        .update(groupMembers)
        .set({ role: GroupRole.Admin })
        .where(
          and(
            eq(groupMembers.groupId, gid),
            eq(groupMembers.userId, currentCreatorId),
            eq(groupMembers.role, GroupRole.Creator),
          ),
        )
        .returning({ userId: groupMembers.userId });
      if (!demoted.length) {
        throw createError({ statusCode: 409, message: "creator_changed" });
      }
      const promoted = await tx
        .update(groupMembers)
        .set({ role: GroupRole.Creator })
        .where(
          and(
            eq(groupMembers.groupId, gid),
            eq(groupMembers.userId, targetUserId),
            ne(groupMembers.role, GroupRole.Creator),
          ),
        )
        .returning({ userId: groupMembers.userId });
      if (!promoted.length) {
        throw createError({ statusCode: 404, message: "not_a_member" });
      }
      return;
    }

    const updated = await tx
      .update(groupMembers)
      .set({ role })
      .where(
        and(
          eq(groupMembers.groupId, gid),
          eq(groupMembers.userId, targetUserId),
          ne(groupMembers.role, GroupRole.Creator),
        ),
      )
      .returning({ userId: groupMembers.userId });
    if (!updated.length) {
      throw createError({ statusCode: 409, message: "member_changed" });
    }
  });
  return getGroupById(gid);
}

export async function deleteGroup(gid: string, actorId: string): Promise<boolean> {
  return writeTransaction(async (tx) => {
    const groupRows = await tx
      .select()
      .from(groups)
      .where(eq(groups.id, gid))
      .limit(1);
    const row = groupRows[0];
    if (!row) return false;
    const memberRows = await tx
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, gid));
    const group = toPublicGroup(
      row,
      memberRows.map((member) => ({ userId: member.userId, role: member.role })),
    );
    if (!canGroupAction({ id: actorId }, group, "group.delete")) {
      throw createError({ statusCode: 403, message: "forbidden" });
    }
    const deleted = await tx
      .delete(groups)
      .where(eq(groups.id, gid))
      .returning({ id: groups.id });
    return deleted.length > 0;
  });
}

export interface ExpensePayload {
  title: string;
  description: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  amountBase: number;
  paidBy: string;
  category: string;
  date: string;
  splitType: string;
  splits: Record<string, number>;
}

export async function getExpenses(gid: string) {
  const rows = await db
    .select()
    .from(expenses)
    .where(eq(expenses.groupId, gid))
    .orderBy(desc(expenses.date), desc(expenses.createdAt));
  const eids = rows.map((e) => e.id);
  const splitMap: Record<string, Record<string, number>> = {};
  if (eids.length) {
    const srows = await db
      .select()
      .from(expenseSplits)
      .where(inArray(expenseSplits.expenseId, eids));
    srows.forEach((s) => {
      (splitMap[s.expenseId] ||= {})[s.userId] = s.amount;
    });
  }
  return rows.map((e) => ({
    id: e.id,
    groupId: e.groupId,
    title: e.title,
    description: e.description,
    amount: e.amount,
    currency: e.currency,
    exchangeRate: e.exchangeRate,
    amountBase: e.amountBase,
    paidBy: e.paidBy,
    category: e.category,
    date: e.date,
    splitType: e.splitType,
    createdBy: e.createdBy,
    createdAt: e.createdAt,
    splits: splitMap[e.id] || {},
  }));
}

export async function createExpense(
  gid: string,
  payload: ExpensePayload,
  creatorId: string,
): Promise<string> {
  const eid = randomUUID();
  const now = Date.now();
  await writeTransaction(async (tx) => {
    await lockGroup(tx, gid);
    const memberRows = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, gid));
    const memberIds = new Set(memberRows.map((member) => member.userId));
    if (
      !memberIds.has(creatorId) ||
      !memberIds.has(payload.paidBy) ||
      Object.keys(payload.splits).some((userId) => !memberIds.has(userId))
    ) {
      throw createError({ statusCode: 403, message: "not_a_member" });
    }
    await tx.insert(expenses).values({
      id: eid,
      groupId: gid,
      title: payload.title,
      description: payload.description,
      amount: payload.amount,
      currency: payload.currency,
      exchangeRate: payload.exchangeRate,
      amountBase: payload.amountBase,
      paidBy: payload.paidBy,
      category: payload.category,
      date: payload.date,
      splitType: payload.splitType,
      createdBy: creatorId,
      createdAt: now,
    });
    for (const uid of Object.keys(payload.splits)) {
      await tx.insert(expenseSplits).values({
        expenseId: eid,
        userId: uid,
        amount: payload.splits[uid] ?? 0,
      });
    }
  });
  return eid;
}

export async function deleteExpenseIfOwner(
  gid: string,
  eid: string,
  requesterId: string,
): Promise<boolean> {
  return writeTransaction(async (tx) => {
    const row = await lockGroup(tx, gid);
    const memberRows = await tx
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, gid));
    const group = toPublicGroup(
      row,
      memberRows.map((member) => ({ userId: member.userId, role: member.role })),
    );
    const target = await tx
      .select({ createdBy: expenses.createdBy })
      .from(expenses)
      .where(and(eq(expenses.id, eid), eq(expenses.groupId, gid)))
      .limit(1);
    if (
      !target[0] ||
      !canGroupAction(
        { id: requesterId },
        group,
        { type: "expense.delete", ownerId: target[0].createdBy },
      )
    ) {
      return false;
    }
    const requesterRole = group.members.find(
      (member) => member.userId === requesterId,
    )?.role;
    const canManageAny =
      requesterRole === GroupRole.Creator || requesterRole === GroupRole.Admin;
    const deleted = await tx
      .delete(expenses)
      .where(
        and(
          eq(expenses.id, eid),
          eq(expenses.groupId, gid),
          ...(canManageAny ? [] : [eq(expenses.createdBy, requesterId)]),
        ),
      )
      .returning({ id: expenses.id });
    return deleted.length > 0;
  });
}

export async function deleteExpenseById(gid: string, eid: string): Promise<boolean> {
  return writeTransaction(async (tx) => {
    await lockGroup(tx, gid);
    const deleted = await tx
      .delete(expenses)
      .where(and(eq(expenses.id, eid), eq(expenses.groupId, gid)))
      .returning({ id: expenses.id });
    return deleted.length > 0;
  });
}

export async function getExpenseOwner(
  gid: string,
  eid: string,
): Promise<string | null> {
  const row = await db
    .select({ createdBy: expenses.createdBy })
    .from(expenses)
    .where(and(eq(expenses.id, eid), eq(expenses.groupId, gid)))
    .limit(1);
  return row[0]?.createdBy ?? null;
}

export async function updateExpenseIfOwner(
  gid: string,
  eid: string,
  payload: ExpensePayload,
  requesterId: string,
): Promise<boolean> {
  return writeTransaction(async (tx) => {
    const row = await lockGroup(tx, gid);
    const memberRows = await tx
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, gid));
    const group = toPublicGroup(
      row,
      memberRows.map((member) => ({ userId: member.userId, role: member.role })),
    );
    const target = await tx
      .select({ createdBy: expenses.createdBy })
      .from(expenses)
      .where(and(eq(expenses.id, eid), eq(expenses.groupId, gid)))
      .limit(1);
    const memberIds = new Set(group.memberIds);
    if (
      !target[0] ||
      !canGroupAction(
        { id: requesterId },
        group,
        { type: "expense.update", ownerId: target[0].createdBy },
      ) ||
      !memberIds.has(payload.paidBy) ||
      Object.keys(payload.splits).some((userId) => !memberIds.has(userId))
    ) {
      return false;
    }
    await tx
      .update(expenses)
      .set({
        title: payload.title,
        description: payload.description,
        amount: payload.amount,
        currency: payload.currency,
        exchangeRate: payload.exchangeRate,
        amountBase: payload.amountBase,
        paidBy: payload.paidBy,
        category: payload.category,
        date: payload.date,
        splitType: payload.splitType,
      })
      .where(eq(expenses.id, eid));
    await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, eid));
    for (const uid of Object.keys(payload.splits)) {
      await tx.insert(expenseSplits).values({
        expenseId: eid,
        userId: uid,
        amount: payload.splits[uid] ?? 0,
      });
    }
    return true;
  });
}

export async function updateGroup(
  gid: string,
  actorId: string,
  patch: {
    name: string;
    emoji: string;
    baseCurrency: string;
    simplifyTransfers: boolean;
  },
): Promise<void> {
  await writeTransaction(async (tx) => {
    const row = await lockGroup(tx, gid);
    const memberRows = await tx
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, gid));
    const group = toPublicGroup(
      row,
      memberRows.map((member) => ({ userId: member.userId, role: member.role })),
    );
    if (!canGroupAction({ id: actorId }, group, "group.settings.update")) {
      throw createError({ statusCode: 403, message: "forbidden" });
    }
    if (patch.baseCurrency !== row.baseCurrency) {
      const expenseCount = await tx
        .select({ n: sql<number>`count(*)` })
        .from(expenses)
        .where(eq(expenses.groupId, gid));
      if ((expenseCount[0]?.n ?? 0) > 0) {
        throw createError({
          statusCode: 409,
          message: "base_currency_locked",
        });
      }
    }
    if (row.simplifyTransfers && !patch.simplifyTransfers) {
      const ledger = await loadPairwiseLedger(gid, tx, row);
      if (
        suggestPairwiseTransfers(ledger.debts).some(
          (transfer) =>
            !ledger.memberIds.includes(transfer.from) ||
            !ledger.memberIds.includes(transfer.to),
        )
      ) {
        throw createError({
          statusCode: 409,
          message: "pairwise_plan_includes_former_members",
        });
      }
    }
    await tx
      .update(groups)
      .set({
        name: patch.name,
        emoji: patch.emoji,
        baseCurrency: patch.baseCurrency,
        simplifyTransfers: patch.simplifyTransfers,
      })
      .where(eq(groups.id, gid));
  });
}

export async function listCategoryIds(): Promise<Set<string>> {
  const rows = await db.select({ id: categories.id }).from(categories);
  return new Set(rows.map((r) => String(r.id)));
}

export interface ImportRow {
  title: string;
  amount: number;
  currency: string;
  paidBy: string;
  category: string;
  date: string;
  splits: Record<string, number>;
}

export async function importExpenses(
  gid: string,
  rows: ImportRow[],
  creatorId: string,
): Promise<number> {
  if (!rows.length) return 0;
  const now = Date.now();
  await writeTransaction(async (tx) => {
    const groupRow = await lockGroup(tx, gid);
    const memberRows = await tx
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, gid));
    const group = toPublicGroup(
      groupRow,
      memberRows.map((member) => ({ userId: member.userId, role: member.role })),
    );
    const memberIds = new Set(group.memberIds);
    if (
      !canGroupAction({ id: creatorId }, group, "import") ||
      rows.some(
        (row) =>
          !memberIds.has(row.paidBy) ||
          Object.keys(row.splits).some((userId) => !memberIds.has(userId)),
      )
    ) {
      throw createError({ statusCode: 403, message: "not_a_member" });
    }
    for (const r of rows) {
      const eid = randomUUID();
      await tx.insert(expenses).values({
        id: eid,
        groupId: gid,
        title: r.title,
        description: "",
        amount: r.amount,
        currency: r.currency,
        exchangeRate: 1,
        amountBase: r.amount,
        paidBy: r.paidBy,
        category: r.category,
        date: r.date,
        splitType: "equal",
        createdBy: creatorId,
        createdAt: now,
      });
      const splitRows = Object.keys(r.splits).map((uid) => ({
        expenseId: eid,
        userId: uid,
        amount: r.splits[uid] ?? 0,
      }));
      if (splitRows.length) await tx.insert(expenseSplits).values(splitRows);
    }
  });
  return rows.length;
}

export interface Balance {
  memberId: string;
  amount: number;
}

export interface SuggestedTransfer {
  from: string;
  to: string;
  amount: number;
}

export async function getBalances(gid: string): Promise<Balance[]> {
  return (await loadPairwiseLedger(gid)).balances;
}

export async function simplifyDebts(gid: string): Promise<SuggestedTransfer[]> {
  const ledger = await loadPairwiseLedger(gid);
  return suggestSimplifiedTransfers(ledger.debts);
}

export async function pairwiseTransfers(gid: string): Promise<SuggestedTransfer[]> {
  const ledger = await loadPairwiseLedger(gid);
  return suggestPairwiseTransfers(ledger.debts);
}

export async function getSettlementPlan(gid: string) {
  const ledger = await loadPairwiseLedger(gid);
  const transfers = ledger.simplifyTransfers
    ? suggestSimplifiedTransfers(ledger.debts)
    : suggestPairwiseTransfers(ledger.debts);
  return {
    balances: ledger.balances,
    transfers,
    simplifyTransfers: ledger.simplifyTransfers,
  };
}

export async function getSettlements(gid: string) {
  const rows = await db
    .select()
    .from(settlements)
    .where(eq(settlements.groupId, gid))
    .orderBy(desc(settlements.createdAt));
  return rows.map((s) => ({
    id: s.id,
    groupId: s.groupId,
    from: s.fromUser,
    to: s.toUser,
    amount: s.amount,
    note: s.note,
    createdBy: s.createdBy,
    createdAt: s.createdAt,
  }));
}

export async function createSettlement(
  gid: string,
  payload: { from: string; to: string; amount?: number; note: string },
  actorId: string,
): Promise<{ id: string; amount: number }> {
  const sid = randomUUID();
  return writeTransaction(async (tx) => {
    const groupRow = await lockGroup(tx, gid);
    const memberRows = await tx
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, gid));
    const group = toPublicGroup(
      groupRow,
      memberRows.map((member) => ({ userId: member.userId, role: member.role })),
    );
    if (!group.memberIds.includes(payload.from) || !group.memberIds.includes(payload.to)) {
      throw createError({ statusCode: 400, message: "Both people must be group members." });
    }
    if (!canGroupAction({ id: actorId }, group, { type: "settlement.create", debtorId: payload.from })) {
      throw createError({ statusCode: 403, message: "forbidden" });
    }
    const ledger = await loadPairwiseLedger(gid, tx, groupRow);
    const suggested = transfersForLedger(ledger).find(
      (transfer) => transfer.from === payload.from && transfer.to === payload.to,
    );
    if (!suggested) {
      throw createError({ statusCode: 400, message: "There is no suggested payment between these members." });
    }
    const requested = payload.amount;
    const amount = requested === undefined ? suggested.amount : Math.round(requested * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw createError({ statusCode: 400, message: "Amount must be greater than zero." });
    }
    if (amount - suggested.amount > 0.004) {
      throw createError({ statusCode: 400, message: "Amount is more than the outstanding debt." });
    }
    const allocation = allocatePayment(ledger.debts, payload.from, payload.to, amount);
    if (!allocation) {
      throw createError({ statusCode: 409, message: "settlement_allocation_failed" });
    }
    const createdAt = Date.now();
    await tx.insert(settlements).values({
      id: sid,
      groupId: gid,
      fromUser: payload.from,
      toUser: payload.to,
      amount,
      note: payload.note,
      createdBy: actorId,
      createdAt,
    });
    if (allocation.allocations.length) {
      await tx.insert(settlementAllocations).values(
        allocation.allocations.map((entry) => ({
          settlementId: sid,
          debtorId: entry.debtorId,
          creditorId: entry.creditorId,
          amount: entry.amount,
        })),
      );
    }
    return { id: sid, amount };
  });
}

export async function deleteSettlementIfOwner(
  gid: string,
  sid: string,
  requesterId: string,
): Promise<boolean> {
  return writeTransaction(async (tx) => {
    await lockGroup(tx, gid);
    const member = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, gid),
          eq(groupMembers.userId, requesterId),
        ),
      )
      .limit(1);
    if (!member.length) return false;
    const deleted = await tx
      .delete(settlements)
      .where(
        and(
          eq(settlements.id, sid),
          eq(settlements.groupId, gid),
          eq(settlements.createdBy, requesterId),
        ),
      )
      .returning({ id: settlements.id });
    return deleted.length > 0;
  });
}

export async function deleteSettlementById(gid: string, sid: string): Promise<boolean> {
  return writeTransaction(async (tx) => {
    await lockGroup(tx, gid);
    const deleted = await tx
      .delete(settlements)
      .where(and(eq(settlements.id, sid), eq(settlements.groupId, gid)))
      .returning({ id: settlements.id });
    return deleted.length > 0;
  });
}

export async function getSettlementRecorder(
  gid: string,
  sid: string,
): Promise<string | null> {
  const row = await db
    .select({ createdBy: settlements.createdBy })
    .from(settlements)
    .where(and(eq(settlements.id, sid), eq(settlements.groupId, gid)))
    .limit(1);
  return row[0]?.createdBy ?? null;
}

export interface RecurringExpensePayload {
  title: string;
  description: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  amountBase: number;
  paidBy: string;
  category: string;
  splitType: string;
  splits: Record<string, number>;
  recurrence: string;
  startDate: string;
}

export async function getRecurringExpenses(gid: string) {
  const rows = await db
    .select()
    .from(recurringExpenses)
    .where(eq(recurringExpenses.groupId, gid))
    .orderBy(desc(recurringExpenses.createdAt));
  return rows.map((r) => ({
    id: r.id,
    groupId: r.groupId,
    title: r.title,
    description: r.description,
    amount: r.amount,
    currency: r.currency,
    exchangeRate: r.exchangeRate,
    amountBase: r.amountBase,
    paidBy: r.paidBy,
    category: r.category,
    splitType: r.splitType,
    splits: r.splits,
    recurrence: r.recurrence,
    startDate: r.startDate,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  }));
}

export async function createRecurringExpense(
  gid: string,
  payload: RecurringExpensePayload,
  creatorId: string,
): Promise<string> {
  const rid = randomUUID();
  await db.insert(recurringExpenses).values({
    id: rid,
    groupId: gid,
    title: payload.title,
    description: payload.description,
    amount: payload.amount,
    currency: payload.currency,
    exchangeRate: payload.exchangeRate,
    amountBase: payload.amountBase,
    paidBy: payload.paidBy,
    category: payload.category,
    splitType: payload.splitType,
    splits: payload.splits,
    recurrence: payload.recurrence,
    startDate: payload.startDate,
    createdBy: creatorId,
    createdAt: Date.now(),
  });
  return rid;
}

export async function updateRecurringExpense(
  gid: string,
  rid: string,
  payload: RecurringExpensePayload,
  requesterId: string,
  canManageAny: boolean,
): Promise<boolean> {
  const updated = await db
    .update(recurringExpenses)
    .set({
      title: payload.title,
      description: payload.description,
      amount: payload.amount,
      currency: payload.currency,
      exchangeRate: payload.exchangeRate,
      amountBase: payload.amountBase,
      paidBy: payload.paidBy,
      category: payload.category,
      splitType: payload.splitType,
      splits: payload.splits,
      recurrence: payload.recurrence,
      startDate: payload.startDate,
    })
    .where(
      and(
        eq(recurringExpenses.id, rid),
        eq(recurringExpenses.groupId, gid),
        canManageAny ? undefined : eq(recurringExpenses.createdBy, requesterId),
      ),
    )
    .returning({ id: recurringExpenses.id });
  return updated.length > 0;
}

export async function getRecurringExpenseOwner(
  gid: string,
  rid: string,
): Promise<string | null> {
  const row = await db
    .select({ createdBy: recurringExpenses.createdBy })
    .from(recurringExpenses)
    .where(
      and(eq(recurringExpenses.id, rid), eq(recurringExpenses.groupId, gid)),
    )
    .limit(1);
  return row[0]?.createdBy ?? null;
}

export async function deleteRecurringExpense(
  gid: string,
  rid: string,
  requesterId: string,
  canManageAny: boolean,
): Promise<boolean> {
  const deleted = await db
    .delete(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.id, rid),
        eq(recurringExpenses.groupId, gid),
        canManageAny ? undefined : eq(recurringExpenses.createdBy, requesterId),
      ),
    )
    .returning({ id: recurringExpenses.id });
  return deleted.length > 0;
}
