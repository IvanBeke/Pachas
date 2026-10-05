import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
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
import { fromCents, toCents } from "../../shared/money";
import { canGroupAction, type GroupPermissionAction } from "./group-permissions";
import {
  lockGroupWithMembers,
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

/*
 * Money crosses this module's boundary in decimal units and is stored as
 * integer cents. Every DB read goes through `fromCents`, every write through
 * `toCents`; no other server module touches the raw columns.
 */

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
  version: number;
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

type GroupRow = typeof groups.$inferSelect;
type QueryExecutor = typeof db | DbTransaction;

function forbidden(): never {
  throw createError({ statusCode: 403, message: "forbidden" });
}

function centsMap(splits: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [uid, amount] of Object.entries(splits)) out[uid] = toCents(amount);
  return out;
}

function decimalMap(splits: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [uid, cents] of Object.entries(splits)) out[uid] = fromCents(cents);
  return out;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

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
  const [expenseRows, splitRows, allocationRows, settlementRows, members, row] =
    await Promise.all([
      query
        .select({ id: expenses.id, paidBy: expenses.paidBy })
        .from(expenses)
        .where(eq(expenses.groupId, gid)),
      query
        .select({
          expenseId: expenseSplits.expenseId,
          userId: expenseSplits.userId,
          amount: expenseSplits.amount,
        })
        .from(expenseSplits)
        .innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
        .where(eq(expenses.groupId, gid)),
      query
        .select({
          debtorId: settlementAllocations.debtorId,
          creditorId: settlementAllocations.creditorId,
          amount: settlementAllocations.amount,
        })
        .from(settlementAllocations)
        .innerJoin(settlements, eq(settlementAllocations.settlementId, settlements.id))
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
  const splitsByExpense = new Map<string, Record<string, number>>();
  for (const split of splitRows) {
    const splits = splitsByExpense.get(split.expenseId) ?? {};
    splits[split.userId] = fromCents(split.amount);
    splitsByExpense.set(split.expenseId, splits);
  }
  const debts = buildPairwiseDebts(
    expenseRows.map((expense) => ({
      paidBy: expense.paidBy,
      splits: splitsByExpense.get(expense.id) ?? {},
    })),
    allocationRows.map((a) => ({ ...a, amount: fromCents(a.amount) })),
  );
  const balanceMap = new Map(
    balancesFromPairwiseDebts(debts).map((balance) => [balance.memberId, balance.amount]),
  );
  // Everyone who ever appeared in the ledger gets a row, even at zero.
  const touch = (id: string) => {
    if (!balanceMap.has(id)) balanceMap.set(id, 0);
  };
  expenseRows.forEach((e) => touch(e.paidBy));
  splitRows.forEach((s) => touch(s.userId));
  settlementRows.forEach((s) => {
    touch(s.fromUser);
    touch(s.toUser);
  });
  allocationRows.forEach((a) => {
    touch(a.debtorId);
    touch(a.creditorId);
  });
  members.forEach((m) => touch(m.userId));
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

export interface SettlementPlan {
  balances: Balance[];
  transfers: SuggestedTransfer[];
  simplifyTransfers: boolean;
}

/**
 * The plan is the most expensive read (transfer simplification is a search),
 * and it only changes when the group's version does, so it is cached per
 * version. Bounded so a server with many groups can't grow it without limit.
 */
const PLAN_CACHE_LIMIT = 256;
const planCache = new Map<string, { version: number; plan: SettlementPlan }>();

export async function getSettlementPlan(
  gid: string,
  version?: number,
): Promise<SettlementPlan> {
  const cached = planCache.get(gid);
  if (version !== undefined && cached?.version === version) return cached.plan;
  const ledger = await loadPairwiseLedger(gid);
  const plan = {
    balances: ledger.balances,
    transfers: transfersForLedger(ledger),
    simplifyTransfers: ledger.simplifyTransfers,
  };
  if (version !== undefined) {
    planCache.delete(gid);
    planCache.set(gid, { version, plan });
    if (planCache.size > PLAN_CACHE_LIMIT) {
      const oldest = planCache.keys().next().value;
      if (oldest !== undefined) planCache.delete(oldest);
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Groups and members
// ---------------------------------------------------------------------------

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
    version: row.version,
  };
}

/**
 * Locks a group inside a write transaction and checks `action` for `actorId`.
 * Every mutation starts here, so permissions are evaluated against the same
 * snapshot the write is applied to.
 */
async function authorizeWrite(
  tx: DbTransaction,
  gid: string,
  actorId: string,
  action: GroupPermissionAction | null,
): Promise<{ row: GroupRow; group: PublicGroup }> {
  const { row, members } = await lockGroupWithMembers(tx, gid);
  const group = toPublicGroup(row, members);
  if (action && !canGroupAction({ id: actorId }, group, action)) forbidden();
  return { row, group };
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

export async function getGroupsForUser(uid: string): Promise<PublicGroup[]> {
  const rows = await db
    .select({ group: groups })
    .from(groups)
    .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, uid))
    .orderBy(desc(groups.createdAt));
  const ids = rows.map((r) => r.group.id);
  const members = await membersByGroup(ids);
  return rows.map((r) => toPublicGroup(r.group, members[r.group.id] || []));
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
  if (!group.memberIds.includes(uid)) {
    throw createError({ statusCode: 403, message: "not_a_member" });
  }
  return group;
}

export async function hasExpenses(gid: string): Promise<boolean> {
  const rows = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.groupId, gid))
    .limit(1);
  return rows.length > 0;
}

export async function getUsersByIds(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.select().from(users).where(inArray(users.id, ids));
  return rows.map((row: DbUser) => publicUser(row));
}

/**
 * Profiles of the requested users that share at least one group with
 * `viewerId` (plus the viewer). Anyone else is indistinguishable from an
 * unknown id, so the endpoint can't be used to enumerate accounts.
 */
export async function getVisibleUsersByIds(viewerId: string, ids: string[]) {
  if (!ids.length) return [];
  const myGroups = db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, viewerId));
  const visible = await db
    .selectDistinct({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(inArray(groupMembers.groupId, myGroups), inArray(groupMembers.userId, ids)));
  const allowed = new Set([viewerId, ...visible.map((v) => v.userId)]);
  return getUsersByIds(ids.filter((id) => allowed.has(id)));
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
    await tx.insert(groupMembers).values(
      members.map((uid) => ({
        groupId: gid,
        userId: uid,
        role: uid === creatorId ? GroupRole.Creator : GroupRole.Member,
      })),
    );
  });
  return getGroupById(gid);
}

export async function addGroupMember(
  gid: string,
  uid: string,
  actorId: string,
): Promise<PublicGroup | null> {
  await writeTransaction(async (tx) => {
    await authorizeWrite(tx, gid, actorId, "member.add");
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
    const { row, group } = await authorizeWrite(tx, gid, actorId, null);
    if (!canGroupAction({ id: actorId }, group, { type: "member.remove", targetUserId: uid })) {
      if (
        uid === actorId &&
        group.members.find((member) => member.userId === actorId)?.role ===
          GroupRole.Creator
      ) {
        throw createError({ statusCode: 400, message: "cannot_remove_self" });
      }
      forbidden();
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
    const { group } = await authorizeWrite(tx, gid, actorId, {
      type: "member.role.change",
      targetUserId,
      role,
    });

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
    await authorizeWrite(tx, gid, actorId, "group.delete");
    const deleted = await tx
      .delete(groups)
      .where(eq(groups.id, gid))
      .returning({ id: groups.id });
    planCache.delete(gid);
    return deleted.length > 0;
  });
}

export async function updateGroup(
  gid: string,
  actorId: string,
  patch: {
    name?: string;
    emoji?: string;
    baseCurrency?: string;
    simplifyTransfers?: boolean;
  },
): Promise<void> {
  await writeTransaction(async (tx) => {
    const { row } = await authorizeWrite(tx, gid, actorId, "group.settings.update");
    const next = {
      name: patch.name ?? row.name,
      emoji: patch.emoji ?? row.emoji,
      baseCurrency: patch.baseCurrency ?? row.baseCurrency,
      simplifyTransfers: patch.simplifyTransfers ?? row.simplifyTransfers,
    };
    // `amount_base` is denormalised into every expense row, so changing the
    // base currency after expenses exist would silently reinterpret the whole
    // historical ledger with no conversion applied. Frozen once money is in.
    if (next.baseCurrency !== row.baseCurrency) {
      const [existing] = await tx
        .select({ n: count() })
        .from(expenses)
        .where(eq(expenses.groupId, gid));
      if ((existing?.n ?? 0) > 0) {
        throw createError({ statusCode: 409, message: "base_currency_locked" });
      }
    }
    if (row.simplifyTransfers && !next.simplifyTransfers) {
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
    await tx.update(groups).set(next).where(eq(groups.id, gid));
  });
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

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
  const [rows, splitRows] = await Promise.all([
    db
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, gid))
      .orderBy(desc(expenses.date), desc(expenses.createdAt)),
    db
      .select({
        expenseId: expenseSplits.expenseId,
        userId: expenseSplits.userId,
        amount: expenseSplits.amount,
      })
      .from(expenseSplits)
      .innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
      .where(eq(expenses.groupId, gid)),
  ]);
  const splitMap: Record<string, Record<string, number>> = {};
  for (const s of splitRows) {
    (splitMap[s.expenseId] ||= {})[s.userId] = fromCents(s.amount);
  }
  return rows.map((e) => ({
    id: e.id,
    groupId: e.groupId,
    title: e.title,
    description: e.description,
    amount: fromCents(e.amount),
    currency: e.currency,
    exchangeRate: e.exchangeRate,
    amountBase: fromCents(e.amountBase),
    paidBy: e.paidBy,
    category: e.category,
    date: e.date,
    splitType: e.splitType,
    createdBy: e.createdBy,
    createdAt: e.createdAt,
    recurringId: e.recurringId,
    splits: splitMap[e.id] || {},
  }));
}

function assertParticipantsAreMembers(
  memberIds: string[],
  payload: { paidBy: string; splits: Record<string, number> },
): void {
  const members = new Set(memberIds);
  if (
    !members.has(payload.paidBy) ||
    Object.keys(payload.splits).some((userId) => !members.has(userId))
  ) {
    throw createError({ statusCode: 403, message: "not_a_member" });
  }
}

function expenseColumns(payload: ExpensePayload) {
  return {
    title: payload.title,
    description: payload.description,
    amount: toCents(payload.amount),
    currency: payload.currency,
    exchangeRate: payload.exchangeRate,
    amountBase: toCents(payload.amountBase),
    paidBy: payload.paidBy,
    category: payload.category,
    date: payload.date,
    splitType: payload.splitType,
  };
}

async function insertSplits(
  tx: DbTransaction,
  expenseId: string,
  splits: Record<string, number>,
): Promise<void> {
  const rows = Object.entries(splits).map(([userId, amount]) => ({
    expenseId,
    userId,
    amount: toCents(amount),
  }));
  if (rows.length) await tx.insert(expenseSplits).values(rows);
}

export async function createExpense(
  gid: string,
  payload: ExpensePayload,
  creatorId: string,
): Promise<string> {
  const eid = randomUUID();
  await writeTransaction(async (tx) => {
    const { group } = await authorizeWrite(tx, gid, creatorId, "expense.create");
    assertParticipantsAreMembers(group.memberIds, payload);
    await tx.insert(expenses).values({
      id: eid,
      groupId: gid,
      ...expenseColumns(payload),
      createdBy: creatorId,
      createdAt: Date.now(),
    });
    await insertSplits(tx, eid, payload.splits);
  });
  return eid;
}

async function expenseOwner(
  tx: DbTransaction,
  gid: string,
  eid: string,
): Promise<string | null> {
  const rows = await tx
    .select({ createdBy: expenses.createdBy })
    .from(expenses)
    .where(and(eq(expenses.id, eid), eq(expenses.groupId, gid)))
    .limit(1);
  return rows[0]?.createdBy ?? null;
}

/**
 * Returns false when the expense doesn't exist or the requester may not touch
 * it; routes turn both into the same 404 so ownership isn't revealed.
 */
export async function deleteExpenseIfAllowed(
  gid: string,
  eid: string,
  requesterId: string,
): Promise<boolean> {
  return writeTransaction(async (tx) => {
    const { group } = await authorizeWrite(tx, gid, requesterId, null);
    const ownerId = await expenseOwner(tx, gid, eid);
    if (
      !ownerId ||
      !canGroupAction({ id: requesterId }, group, { type: "expense.delete", ownerId })
    ) {
      return false;
    }
    const deleted = await tx
      .delete(expenses)
      .where(and(eq(expenses.id, eid), eq(expenses.groupId, gid)))
      .returning({ id: expenses.id });
    return deleted.length > 0;
  });
}

export async function updateExpenseIfAllowed(
  gid: string,
  eid: string,
  readPayload: (group: PublicGroup) => ExpensePayload,
  requesterId: string,
): Promise<boolean> {
  return writeTransaction(async (tx) => {
    const { group } = await authorizeWrite(tx, gid, requesterId, null);
    const ownerId = await expenseOwner(tx, gid, eid);
    if (
      !ownerId ||
      !canGroupAction({ id: requesterId }, group, { type: "expense.update", ownerId })
    ) {
      return false;
    }
    const payload = readPayload(group);
    assertParticipantsAreMembers(group.memberIds, payload);
    await tx.update(expenses).set(expenseColumns(payload)).where(eq(expenses.id, eid));
    await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, eid));
    await insertSplits(tx, eid, payload.splits);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

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

const IMPORT_BATCH = 200;

export async function importExpenses(
  gid: string,
  rows: ImportRow[],
  creatorId: string,
): Promise<number> {
  if (!rows.length) return 0;
  const now = Date.now();
  await writeTransaction(async (tx) => {
    const { group } = await authorizeWrite(tx, gid, creatorId, "import");
    for (const row of rows) assertParticipantsAreMembers(group.memberIds, row);
    if (rows.some((row) => row.currency !== group.baseCurrency)) {
      throw createError({ statusCode: 400, message: "currency_mismatch" });
    }
    for (let i = 0; i < rows.length; i += IMPORT_BATCH) {
      const batch = rows.slice(i, i + IMPORT_BATCH).map((r) => ({
        id: randomUUID(),
        row: r,
      }));
      await tx.insert(expenses).values(
        batch.map(({ id, row }) => ({
          id,
          groupId: gid,
          title: row.title,
          description: "",
          amount: toCents(row.amount),
          currency: row.currency,
          exchangeRate: 1,
          amountBase: toCents(row.amount),
          paidBy: row.paidBy,
          category: row.category,
          date: row.date,
          splitType: "exact",
          createdBy: creatorId,
          createdAt: now,
        })),
      );
      const splitRows = batch.flatMap(({ id, row }) =>
        Object.entries(row.splits).map(([userId, amount]) => ({
          expenseId: id,
          userId,
          amount: toCents(amount),
        })),
      );
      if (splitRows.length) await tx.insert(expenseSplits).values(splitRows);
    }
  });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

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
    amount: fromCents(s.amount),
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
    const { row, group } = await authorizeWrite(tx, gid, actorId, null);
    if (!group.memberIds.includes(payload.from) || !group.memberIds.includes(payload.to)) {
      throw createError({ statusCode: 400, message: "Both people must be group members." });
    }
    if (!canGroupAction({ id: actorId }, group, { type: "settlement.create", debtorId: payload.from })) {
      forbidden();
    }
    const ledger = await loadPairwiseLedger(gid, tx, row);
    const suggested = transfersForLedger(ledger).find(
      (transfer) => transfer.from === payload.from && transfer.to === payload.to,
    );
    if (!suggested) {
      throw createError({ statusCode: 400, message: "There is no suggested payment between these members." });
    }
    const amountCents =
      payload.amount === undefined ? toCents(suggested.amount) : toCents(payload.amount);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw createError({ statusCode: 400, message: "Amount must be greater than zero." });
    }
    if (amountCents > toCents(suggested.amount)) {
      throw createError({ statusCode: 400, message: "Amount is more than the outstanding debt." });
    }
    const amount = fromCents(amountCents);
    const allocation = allocatePayment(ledger.debts, payload.from, payload.to, amount);
    if (!allocation) {
      throw createError({ statusCode: 409, message: "settlement_allocation_failed" });
    }
    await tx.insert(settlements).values({
      id: sid,
      groupId: gid,
      fromUser: payload.from,
      toUser: payload.to,
      amount: amountCents,
      note: payload.note,
      createdBy: actorId,
      createdAt: Date.now(),
    });
    if (allocation.allocations.length) {
      await tx.insert(settlementAllocations).values(
        allocation.allocations.map((entry) => ({
          settlementId: sid,
          debtorId: entry.debtorId,
          creditorId: entry.creditorId,
          amount: toCents(entry.amount),
        })),
      );
    }
    return { id: sid, amount };
  });
}

export async function deleteSettlementIfAllowed(
  gid: string,
  sid: string,
  requesterId: string,
): Promise<boolean> {
  return writeTransaction(async (tx) => {
    const { group } = await authorizeWrite(tx, gid, requesterId, null);
    const rows = await tx
      .select({ createdBy: settlements.createdBy })
      .from(settlements)
      .where(and(eq(settlements.id, sid), eq(settlements.groupId, gid)))
      .limit(1);
    const recorderId = rows[0]?.createdBy;
    if (
      !recorderId ||
      !canGroupAction({ id: requesterId }, group, { type: "settlement.delete", recorderId })
    ) {
      return false;
    }
    const deleted = await tx
      .delete(settlements)
      .where(and(eq(settlements.id, sid), eq(settlements.groupId, gid)))
      .returning({ id: settlements.id });
    return deleted.length > 0;
  });
}

// ---------------------------------------------------------------------------
// Recurring templates
// ---------------------------------------------------------------------------

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
  endDate: string | null;
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
    amount: fromCents(r.amount),
    currency: r.currency,
    exchangeRate: r.exchangeRate,
    amountBase: fromCents(r.amountBase),
    paidBy: r.paidBy,
    category: r.category,
    splitType: r.splitType,
    splits: decimalMap(r.splits),
    recurrence: r.recurrence,
    startDate: r.startDate,
    endDate: r.endDate,
    generatedThrough: r.generatedThrough,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  }));
}

function recurringColumns(payload: RecurringExpensePayload) {
  return {
    title: payload.title,
    description: payload.description,
    amount: toCents(payload.amount),
    currency: payload.currency,
    exchangeRate: payload.exchangeRate,
    amountBase: toCents(payload.amountBase),
    paidBy: payload.paidBy,
    category: payload.category,
    splitType: payload.splitType,
    splits: centsMap(payload.splits),
    recurrence: payload.recurrence,
    startDate: payload.startDate,
    endDate: payload.endDate,
  };
}

export async function createRecurringExpense(
  gid: string,
  payload: RecurringExpensePayload,
  creatorId: string,
): Promise<string> {
  const rid = randomUUID();
  await writeTransaction(async (tx) => {
    const { group } = await authorizeWrite(tx, gid, creatorId, "recurring.create");
    assertParticipantsAreMembers(group.memberIds, payload);
    await tx.insert(recurringExpenses).values({
      id: rid,
      groupId: gid,
      ...recurringColumns(payload),
      generatedThrough: null,
      createdBy: creatorId,
      createdAt: Date.now(),
    });
  });
  return rid;
}

async function recurringOwner(
  tx: DbTransaction,
  gid: string,
  rid: string,
): Promise<string | null> {
  const rows = await tx
    .select({ createdBy: recurringExpenses.createdBy })
    .from(recurringExpenses)
    .where(and(eq(recurringExpenses.id, rid), eq(recurringExpenses.groupId, gid)))
    .limit(1);
  return rows[0]?.createdBy ?? null;
}

export async function updateRecurringExpenseIfAllowed(
  gid: string,
  rid: string,
  readPayload: (group: PublicGroup) => RecurringExpensePayload,
  requesterId: string,
): Promise<boolean> {
  return writeTransaction(async (tx) => {
    const { group } = await authorizeWrite(tx, gid, requesterId, null);
    const ownerId = await recurringOwner(tx, gid, rid);
    if (
      !ownerId ||
      !canGroupAction({ id: requesterId }, group, { type: "recurring.update", ownerId })
    ) {
      return false;
    }
    const payload = readPayload(group);
    assertParticipantsAreMembers(group.memberIds, payload);
    // `generated_through` is kept: editing a template changes future
    // occurrences only and never re-creates past ones.
    await tx
      .update(recurringExpenses)
      .set(recurringColumns(payload))
      .where(eq(recurringExpenses.id, rid));
    return true;
  });
}

export async function deleteRecurringExpenseIfAllowed(
  gid: string,
  rid: string,
  requesterId: string,
): Promise<boolean> {
  return writeTransaction(async (tx) => {
    const { group } = await authorizeWrite(tx, gid, requesterId, null);
    const ownerId = await recurringOwner(tx, gid, rid);
    if (
      !ownerId ||
      !canGroupAction({ id: requesterId }, group, { type: "recurring.delete", ownerId })
    ) {
      return false;
    }
    const deleted = await tx
      .delete(recurringExpenses)
      .where(and(eq(recurringExpenses.id, rid), eq(recurringExpenses.groupId, gid)))
      .returning({ id: recurringExpenses.id });
    return deleted.length > 0;
  });
}
