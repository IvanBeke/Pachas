import { createError } from "h3";

/**
 * Splitwise CSV export parsing.
 *
 * Member columns hold NET balances for the row, not raw shares: the payer's
 * own portion is already deducted, so a payer who fronts a 10.20 bill and
 * owes half of it shows +5.10. So a negative balance is that member's exact
 * share, and the payer's own share is the remainder once debtors are counted.
 */

export interface SplitwiseRow {
  date: string;
  title: string;
  category: string;
  amount: number;
  currency: string;
  /** CSV member name of the payer. */
  paidBy: string;
  /** Keyed by CSV member name. */
  splits: Record<string, number>;
}

export interface SplitwiseAnalysis {
  /** CSV member column names, in file order. */
  members: string[];
  /** Distinct non-empty category strings. */
  categories: string[];
  rows: SplitwiseRow[];
  /** Rows that will be created. */
  total: number;
  /** Rows dropped as unusable. */
  skipped: number;
  totalAmount: number;
}

const FIXED_HEADER = ["Fecha", "Descripción", "Categoría", "Coste", "Moneda"];

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Turns one row of net balances into concrete shares.
 * Returns null when the row represents no new expense.
 */
function deriveSplits(
  balances: number[],
  members: string[],
  amount: number,
): { paidBy: string; splits: Record<string, number> } | null {
  let payerIdx = -1;
  let maxBal = 0;
  for (let j = 0; j < balances.length; j++) {
    const bal = balances[j] ?? 0;
    if (bal > maxBal) {
      maxBal = bal;
      payerIdx = j;
    }
  }
  if (payerIdx === -1) return null;
  const payer = members[payerIdx];
  if (!payer) return null;

  const splits: Record<string, number> = {};
  let owed = 0;
  for (let j = 0; j < balances.length; j++) {
    const bal = balances[j] ?? 0;
    const who = members[j];
    if (bal < 0 && who) {
      const share = round2(Math.abs(bal));
      splits[who] = share;
      owed += share;
    }
  }
  // No negative balance anywhere means the row carries no new expense
  // (balances that only reflect pre-existing debt).
  if (!Object.keys(splits).length) return null;

  // The payer participated too unless they fronted the whole bill. They are
  // not a debtor (their balance is positive) so they have no entry yet —
  // `?? 0` is required, since `undefined + n` is NaN and JSON.stringify
  // writes NaN as null, which the server reads back as 0.
  const payerShare = round2(amount - owed);
  if (payerShare > 0.005) {
    splits[payer] = round2((splits[payer] ?? 0) + payerShare);
  }

  // Safety net for rows whose balances don't reconcile (e.g. Splitwise
  // aggregated several payments into one row). Shares must sum to the cost.
  const splitSum = Object.values(splits).reduce((a, b) => a + b, 0);
  if (Math.abs(splitSum - amount) > 0.001) {
    const diff = round2(amount - splitSum);
    const maxKey = Object.keys(splits).reduce((a, b) =>
      (splits[a] ?? 0) > (splits[b] ?? 0) ? a : b,
    );
    if (maxKey) splits[maxKey] = round2((splits[maxKey] ?? 0) + diff);
  }

  // Never let a non-finite share escape: it would serialise as null and fail
  // the totals check, poisoning the whole import.
  if (Object.values(splits).some((v) => !Number.isFinite(v))) return null;

  return { paidBy: payer, splits };
}

/**
 * Parses and validates a Splitwise export. Throws a 400 with a translated-
 * ready message when the file can't be used at all.
 */
export function analyzeSplitwiseCsv(
  text: string,
  groupMemberCount: number,
): SplitwiseAnalysis {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw createError({ statusCode: 400, message: "no_data" });
  }

  const header = parseCsvLine(lines[0] ?? "");
  for (let i = 0; i < FIXED_HEADER.length; i++) {
    if (header[i] !== FIXED_HEADER[i]) {
      throw createError({
        statusCode: 400,
        message: "bad_header",
        data: { col: i + 1, expected: FIXED_HEADER[i], got: header[i] ?? "" },
      });
    }
  }

  const members = header.slice(5).filter((m) => m.length > 0);
  if (members.length !== groupMemberCount) {
    throw createError({
      statusCode: 400,
      message: "member_count",
      data: { csv: members.length, group: groupMemberCount },
    });
  }

  const rows: SplitwiseRow[] = [];
  const catSet = new Set<string>();
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine((lines[i] ?? "").trim());
    const coste = cols[3]?.trim();
    // Rows without a cost are not expense rows.
    if (!coste) continue;

    const date = cols[0]?.trim();
    const title = cols[1]?.trim();
    const category = cols[2]?.trim() ?? "";
    const amount = parseFloat(coste);
    const currency = cols[4]?.trim();
    if (!date || !title || !amount || amount <= 0 || !currency) {
      skipped++;
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      skipped++;
      continue;
    }

    const balances: number[] = [];
    for (let j = 5; j < cols.length; j++) {
      const v = parseFloat(cols[j] ?? "");
      balances.push(Number.isFinite(v) ? v : 0);
    }

    const derived = deriveSplits(balances, members, amount);
    if (!derived) {
      skipped++;
      continue;
    }

    rows.push({ date, title, category, amount, currency, ...derived });
    if (category) catSet.add(category);
  }

  return {
    members,
    categories: [...catSet],
    rows,
    total: rows.length,
    skipped,
    totalAmount: round2(rows.reduce((a, r) => a + r.amount, 0)),
  };
}
