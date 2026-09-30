import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import {
  categories,
  expenseSplits,
  expenses,
  groupMembers,
  groups,
  recurringExpenses,
  settlements,
  users,
} from "../db/schema";
import { publicUser, type DbUser } from "./auth";

export interface PublicGroup {
  id: string;
  name: string;
  emoji: string | null;
  baseCurrency: string;
  simplifyTransfers: boolean;
  memberIds: string[];
  createdBy: string | null;
  createdAt: number;
}

type GroupRow = typeof groups.$inferSelect;

function toPublicGroup(row: GroupRow, memberIds: string[]): PublicGroup {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    baseCurrency: row.baseCurrency,
    simplifyTransfers: row.simplifyTransfers,
    memberIds,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

async function membersByGroup(
  gids: string[],
): Promise<Record<string, string[]>> {
  if (!gids.length) return {};
  const rows = await db
    .select()
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, gids));
  const map: Record<string, string[]> = {};
  gids.forEach((id) => {
    map[id] = [];
  });
  rows.forEach((r) => {
    (map[r.groupId] ||= []).push(r.userId);
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
  await db.transaction(async (tx) => {
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
        .values({ groupId: gid, userId: uid })
        .onConflictDoNothing();
    }
  });
  return getGroupById(gid);
}

export async function addGroupMember(
  gid: string,
  uid: string,
): Promise<PublicGroup | null> {
  await db
    .insert(groupMembers)
    .values({ groupId: gid, userId: uid })
    .onConflictDoNothing();
  return getGroupById(gid);
}

export async function removeGroupMember(
  gid: string,
  uid: string,
): Promise<PublicGroup | null> {
  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, gid), eq(groupMembers.userId, uid)));
  return getGroupById(gid);
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
  await db.transaction(async (tx) => {
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
  isAdmin: boolean,
): Promise<boolean> {
  // Admins bypass the creator filter, matching updateExpenseIfOwner and the
  // UI, which offers the delete button to admins. The creator filter is what
  // makes a non-owner get 404 rather than confirming the row exists.
  const deleted = await db
    .delete(expenses)
    .where(
      and(
        eq(expenses.id, eid),
        eq(expenses.groupId, gid),
        ...(isAdmin ? [] : [eq(expenses.createdBy, requesterId)]),
      ),
    )
    .returning({ id: expenses.id });
  return deleted.length > 0;
}

export async function updateExpenseIfOwner(
  gid: string,
  eid: string,
  payload: ExpensePayload,
  requesterId: string,
  isAdmin: boolean,
): Promise<boolean> {
  // The creator filter is what makes non-owners 404 rather than 403, so a
  // plain member can't probe for the existence of someone else's expense.
  const target = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(
      and(
        eq(expenses.id, eid),
        eq(expenses.groupId, gid),
        ...(isAdmin ? [] : [eq(expenses.createdBy, requesterId)]),
      ),
    )
    .limit(1);
  if (!target.length) return false;

  await db.transaction(async (tx) => {
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
  });
  return true;
}

/** How many expenses a group holds; used to gate currency changes. */
export async function countExpenses(gid: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(expenses)
    .where(eq(expenses.groupId, gid));
  return rows[0]?.n ?? 0;
}

export async function updateGroup(
  gid: string,
  patch: {
    name: string;
    emoji: string;
    baseCurrency: string;
    simplifyTransfers: boolean;
  },
): Promise<void> {
  await db
    .update(groups)
    .set({
      name: patch.name,
      emoji: patch.emoji,
      baseCurrency: patch.baseCurrency,
      simplifyTransfers: patch.simplifyTransfers,
    })
    .where(eq(groups.id, gid));
}

/** Ids of every existing category, so imports can't invent new ones. */
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
  /** Keyed by group member id; must sum to `amount`. */
  splits: Record<string, number>;
}

/**
 * Creates a whole import in a single transaction: either every row lands or
 * none does. Split rows are batched per expense so a 1000+ row import doesn't
 * issue thousands of round trips.
 */
export async function importExpenses(
  gid: string,
  rows: ImportRow[],
  creatorId: string,
): Promise<number> {
  if (!rows.length) return 0;
  const now = Date.now();
  await db.transaction(async (tx) => {
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
  /** Positive = is owed, negative = owes. In the group's base currency. */
  amount: number;
}

export interface SuggestedTransfer {
  from: string;
  to: string;
  amount: number;
}

/**
 * Net balance per member: what they paid out minus what they owe, with
 * settlements treated as debt repayment. Authoritative version of the
 * client-side `computeBalances`; both must agree.
 */
export async function getBalances(gid: string): Promise<Balance[]> {
  const [expenseRows, settlementRows, memberRows] = await Promise.all([
    db
      .select({
        paidBy: expenses.paidBy,
        amountBase: expenses.amountBase,
      })
      .from(expenses)
      .where(eq(expenses.groupId, gid)),
    db
      .select({ from: settlements.fromUser, to: settlements.toUser, amount: settlements.amount })
      .from(settlements)
      .where(eq(settlements.groupId, gid)),
    db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, gid)),
  ]);
  const splitsByExpense: Record<string, Record<string, number>> = {};
  if (expenseRows.length) {
    const eids = (
      await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.groupId, gid))
    ).map((e) => e.id);
    if (eids.length) {
      const splitRows = await db
        .select()
        .from(expenseSplits)
        .where(inArray(expenseSplits.expenseId, eids));
      for (const s of splitRows) {
        (splitsByExpense[s.expenseId] ||= {})[s.userId] = s.amount;
      }
    }
  }

  const bal: Record<string, number> = {};
  for (const m of memberRows) bal[m.userId] = 0;
  for (const e of expenseRows) {
    bal[e.paidBy] = (bal[e.paidBy] || 0) + e.amountBase;
  }
  for (const eids of Object.keys(splitsByExpense)) {
    for (const [uid, v] of Object.entries(splitsByExpense[eids] ?? {})) {
      bal[uid] = (bal[uid] || 0) - v;
    }
  }
  for (const s of settlementRows) {
    bal[s.from] = (bal[s.from] || 0) + s.amount;
    bal[s.to] = (bal[s.to] || 0) - s.amount;
  }
  return Object.keys(bal).map((memberId) => ({
    memberId,
    amount: Math.round((bal[memberId] ?? 0) * 100) / 100,
  }));
}

/**
 * Greedy netting: pair the largest debtor with the largest creditor and move
 * the smaller of the two remaining amounts, advancing whichever side is
 * exhausted. Produces at most n-1 transfers, the minimum possible.
 */
export function simplifyDebts(balances: Balance[]): SuggestedTransfer[] {
  const creditors: { id: string; amt: number }[] = [];
  const debtors: { id: string; amt: number }[] = [];
  for (const b of balances) {
    const v = Math.round(b.amount * 100) / 100;
    if (v > 0.004) creditors.push({ id: b.memberId, amt: v });
    else if (v < -0.004) debtors.push({ id: b.memberId, amt: -v });
  }
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);
  const tx: SuggestedTransfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    if (!d || !c) break;
    const amt = Math.min(d.amt, c.amt);
    tx.push({ from: d.id, to: c.id, amount: Math.round(amt * 100) / 100 });
    d.amt -= amt;
    c.amt -= amt;
    if (d.amt < 0.005) i++;
    if (c.amt < 0.005) j++;
  }
  return tx;
}

/**
 * Every debtor pays every creditor the smaller of what they owe and what is
 * owed, so each pair is settled directly instead of being netted through
 * intermediaries. Long, but it only involves pairs that actually shared
 * something.
 */
export function pairwiseTransfers(balances: Balance[]): SuggestedTransfer[] {
  const creditors = balances
    .filter((b) => b.amount > 0.004)
    .map((b) => ({ id: b.memberId, amt: Math.round(b.amount * 100) / 100 }));
  const debtors = balances
    .filter((b) => b.amount < -0.004)
    .map((b) => ({ id: b.memberId, amt: Math.round(-b.amount * 100) / 100 }));
  const tx: SuggestedTransfer[] = [];
  for (const d of debtors) {
    let remaining = d.amt;
    for (const c of creditors) {
      if (remaining < 0.005) break;
      const amt = Math.min(remaining, c.amt);
      if (amt < 0.005) continue;
      tx.push({ from: d.id, to: c.id, amount: Math.round(amt * 100) / 100 });
      remaining = Math.round((remaining - amt) * 100) / 100;
      c.amt = Math.round((c.amt - amt) * 100) / 100;
    }
  }
  return tx;
}

/** Balances plus the transfers that would settle them, per the group setting. */
export async function getSettlementPlan(gid: string) {
  const balances = await getBalances(gid);
  const group = await getGroupById(gid);
  const simplify = group?.simplifyTransfers ?? true;
  return {
    balances,
    transfers: simplify ? simplifyDebts(balances) : pairwiseTransfers(balances),
    simplifyTransfers: simplify,
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
  payload: { from: string; to: string; amount: number; note: string },
  creatorId: string,
): Promise<string> {
  const sid = randomUUID();
  await db.insert(settlements).values({
    id: sid,
    groupId: gid,
    fromUser: payload.from,
    toUser: payload.to,
    amount: payload.amount,
    note: payload.note,
    createdBy: creatorId,
    createdAt: Date.now(),
  });
  return sid;
}

export async function deleteSettlementIfOwner(
  gid: string,
  sid: string,
  requesterId: string,
): Promise<boolean> {
  const deleted = await db
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
  isAdmin: boolean,
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
        isAdmin ? undefined : eq(recurringExpenses.createdBy, requesterId),
      ),
    )
    .returning({ id: recurringExpenses.id });
  return updated.length > 0;
}

export async function deleteRecurringExpense(
  gid: string,
  rid: string,
  requesterId: string,
  isAdmin: boolean,
): Promise<boolean> {
  const deleted = await db
    .delete(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.id, rid),
        eq(recurringExpenses.groupId, gid),
        isAdmin ? undefined : eq(recurringExpenses.createdBy, requesterId),
      ),
    )
    .returning({ id: recurringExpenses.id });
  return deleted.length > 0;
}
