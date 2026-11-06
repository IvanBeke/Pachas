import { createError } from "h3";
import {
  computeSplits,
  isSplitType,
  sumSplits,
  type ExpenseItem,
  type RoundingRing,
  type SplitFailure,
} from "../../shared/splits";
import { MAX_AMOUNT, round2, toCents } from "../../shared/money";
import type { ExpensePayload } from "./groups";
import type { CategoryContext } from "./categories";

/** Human-readable 400s for each way a split selection can be invalid. */
const SPLIT_ERRORS: Record<SplitFailure, string> = {
  exact_mismatch: "Exact amounts must add up to the total.",
  percent_mismatch: "Percentages must add up to 100.",
  no_shares: "Shares must add up to more than zero.",
  no_participants: "At least one participant is required.",
  bad_items: "At least one item is required.",
  bad_amount: "Amount must be a finite number.",
};

const MAX_ITEMS = 200;

interface RawBody {
  title?: unknown;
  description?: unknown;
  amount?: unknown;
  currency?: unknown;
  exchangeRate?: unknown;
  paidBy?: unknown;
  category?: unknown;
  date?: unknown;
  splitType?: unknown;
  /** Who takes part in the split. The server computes the amounts. */
  participants?: unknown;
  /** Per-member input values: exact amount, percent, or share weight. */
  values?: unknown;
}

function bad(message: string): never {
  throw createError({ statusCode: 400, message });
}

/**
 * The stored category id for an expense. A missing or empty category becomes
 * the default; anything else must be a real category.
 */
export function readCategory(value: unknown, categories: CategoryContext): string {
  const raw = value === undefined || value === null ? "" : String(value).trim();
  if (raw === "") return categories.defaultId;
  if (!categories.validIds.has(raw)) bad("bad_category");
  return raw;
}

/** A real calendar date in `YYYY-MM-DD` form (rejects e.g. 2024-02-31). */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

/** Validates a currency code from user input, upper-casing it first. */
export function readCurrency(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  const code = String(value).trim().toUpperCase();
  if (!isCurrencyCode(code)) bad("Currency must be a three-letter ISO 4217 code.");
  return code;
}

/** A positive, finite amount within `MAX_AMOUNT`, rounded to cents. */
export function readAmount(value: unknown, message = "Amount must be greater than zero."): number {
  const n = Number(value);
  // `!x || x <= 0` alone does NOT catch non-finite numbers: `Number("1e400")`
  // is `Infinity`, which would poison every downstream sum with `NaN`.
  if (!Number.isFinite(n)) bad("Amount must be a finite number.");
  if (n > MAX_AMOUNT) bad("Amount is too large.");
  if (toCents(n) <= 0) bad(message);
  return round2(n);
}

/**
 * Parses and validates the itemised bill carried in `description`. This is the
 * only source of item data: the split is computed from exactly what is stored,
 * so the stored bill and the stored shares cannot disagree.
 */
function readItems(description: string, memberIds: string[]): ExpenseItem[] {
  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(description);
  } catch {
    bad("Invalid items payload.");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
    bad("Invalid items payload.");
  }
  if (!parsed.items.length) bad("At least one item is required.");
  if (parsed.items.length > MAX_ITEMS) bad(`At most ${MAX_ITEMS} items.`);
  const items: ExpenseItem[] = [];
  for (const raw of parsed.items as { name?: unknown; price?: unknown; members?: unknown }[]) {
    const price = Number(raw?.price);
    if (
      !raw ||
      typeof raw.name !== "string" ||
      !raw.name.trim() ||
      !Number.isFinite(price) ||
      toCents(price) <= 0 ||
      price > MAX_AMOUNT
    ) {
      bad("Every item needs a name and a price greater than zero.");
    }
    if (!Array.isArray(raw.members) || !raw.members.length) {
      bad("Every item needs at least one person assigned.");
    }
    const members: string[] = [];
    for (const uid of raw.members) {
      if (typeof uid !== "string" || !memberIds.includes(uid)) {
        bad("Item members must be group members.");
      }
      if (!members.includes(uid)) members.push(uid);
    }
    items.push({ name: raw.name.trim().slice(0, 80), price: round2(price), members });
  }
  return items;
}

/**
 * Validates and normalises an expense payload. Shared by the create, update
 * and recurring routes so all of them reject the same malformed input.
 *
 * The client sends the SELECTION (which type, who takes part, and their input
 * values) and the amount in the expense currency. Everything derived — the
 * base-currency amount and every share — is computed here. `rounding` says
 * whose turn it is to get a leftover cent; the payload carries the cursor the
 * group should move to.
 */
export function readExpenseInput(
  b: RawBody,
  memberIds: string[],
  baseCurrency: string,
  categories: CategoryContext,
  rounding?: RoundingRing,
): ExpensePayload {
  if (!b || typeof b !== "object") bad("Invalid request body.");
  const title = String(b.title ?? "").trim().slice(0, 80);
  if (!title) bad("A title is required.");

  const splitType = b.splitType === undefined ? "equal" : b.splitType;
  if (!isSplitType(splitType)) bad("Unknown split type.");

  const currency = readCurrency(b.currency, baseCurrency);
  // Same currency means no conversion, whatever rate was sent.
  let rate = 1;
  if (currency !== baseCurrency) {
    const rawRate = Number(b.exchangeRate);
    if (!Number.isFinite(rawRate) || rawRate <= 0 || rawRate > 1_000_000) {
      bad("Exchange rate must be a positive number.");
    }
    rate = rawRate;
  }

  // Items payloads carry member UUIDs and need headroom; plain text stays short.
  let description = String(b.description ?? "")
    .trim()
    .slice(0, splitType === "items" ? 20_000 : 500);

  const amount = readAmount(b.amount);
  // Cents like every stored amount: a converted total is rounded to the cent.
  const amountBase = round2(amount * rate);
  if (toCents(amountBase) <= 0) bad("Invalid converted amount.");
  if (amountBase > MAX_AMOUNT) bad("Amount is too large.");

  let items: ExpenseItem[] | undefined;
  if (splitType === "items") {
    items = readItems(description, memberIds);
    const subtotal = items.reduce((a, it) => a + toCents(it.price), 0);
    if (subtotal !== toCents(amount)) {
      bad("Items total does not match the expense total.");
    }
    // Store the bill exactly as validated, so what is saved is what the shares came from.
    description = JSON.stringify({ items });
  }

  const paidBy = String(b.paidBy ?? "");
  if (!memberIds.includes(paidBy)) bad("Payer must be a group member.");

  const participants = Array.isArray(b.participants)
    ? [...new Set((b.participants as unknown[]).map(String))].filter((uid) =>
        memberIds.includes(uid),
      )
    : [];
  if (!participants.length && splitType !== "items") {
    bad("At least one participant is required.");
  }

  const values: Record<string, number> = {};
  if (b.values && typeof b.values === "object" && !Array.isArray(b.values)) {
    for (const [uid, raw] of Object.entries(b.values as Record<string, unknown>)) {
      if (!memberIds.includes(uid)) continue;
      const v = Number(raw);
      if (Number.isFinite(v)) values[uid] = v;
    }
  }

  const computed = computeSplits({
    splitType,
    amount,
    amountBase,
    participants,
    memberIds: [...memberIds],
    values,
    items,
    rounding,
  });
  if (!computed.ok) bad(SPLIT_ERRORS[computed.reason]);
  const splits = computed.splits;
  if (!Object.keys(splits).length) bad("At least one participant is required.");
  // Belt-and-braces: the shared maths guarantees this, but this is the guard
  // that protects the ledger, so it verifies rather than assumes.
  if (
    !Object.values(splits).every((v) => Number.isFinite(v)) ||
    toCents(sumSplits(splits)) !== toCents(amountBase)
  ) {
    bad("Splits do not add up to the total.");
  }

  return {
    title,
    description,
    amount,
    currency,
    exchangeRate: rate,
    amountBase,
    paidBy,
    category: readCategory(b.category, categories),
    date: isDateOnly(b.date) ? b.date : new Date().toISOString().slice(0, 10),
    splitType,
    splits,
    splitInput: { participants, values },
    nextCursor: computed.nextCursor,
  };
}
