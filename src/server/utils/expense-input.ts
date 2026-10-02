import { createError } from "h3";
import {
  computeSplits,
  round2,
  sumSplits,
  type ExpenseItem,
  type SplitFailure,
  type SplitType,
} from "../../shared/splits";
import type { ExpensePayload } from "./groups";

/** Human-readable 400s for each way a split selection can be invalid. */
const SPLIT_ERRORS: Record<SplitFailure, string> = {
  exact_mismatch: "Exact amounts must add up to the total.",
  percent_mismatch: "Percentages must add up to 100.",
  no_shares: "Shares must add up to more than zero.",
  no_participants: "At least one participant is required.",
  bad_items: "At least one item is required.",
  bad_amount: "Amount must be a finite number.",
};

interface RawBody {
  title?: unknown;
  description?: unknown;
  amount?: unknown;
  currency?: unknown;
  exchangeRate?: unknown;
  amountBase?: unknown;
  paidBy?: unknown;
  category?: unknown;
  date?: unknown;
  splitType?: unknown;
  /** Who takes part in the split. The server computes the amounts. */
  participants?: unknown;
  /** Per-member input values: exact amount, percent, or share weight. */
  values?: unknown;
  /** Itemised bill, for splitType "items". */
  items?: unknown;
}

/**
 * Validates and normalises an expense payload. Shared by the create and
 * update routes so both reject the same malformed input — the items
 * description is JSON, and must keep parsing the same way on edit.
 */
export function readExpenseInput(
  b: RawBody,
  memberIds: string[],
  baseCurrency: string,
): ExpensePayload {
  const title = String(b.title || "").trim().slice(0, 80);
  const splitType = String(b.splitType || "equal") as SplitType;
  // Items payloads carry member UUIDs and need headroom; plain text stays short.
  const description = String(b.description || "")
    .trim()
    .slice(0, splitType === "items" ? 10000 : 500);
  const amount = Number(b.amount);
  const amountBase = Number(b.amountBase);
  if (!title) {
    throw createError({ statusCode: 400, message: "A title is required." });
  }
  // Reject non-finite numbers up front. `!x || x <= 0` does NOT catch these:
  // `Number("1e400")` is `Infinity`, which is truthy and greater than zero, so
  // it walks straight through. It then poisons the split maths — `Infinity -
  // Infinity` is `NaN`, every downstream comparison against `NaN` is false, and
  // the reconciliation guard below is silently defeated. A single such expense
  // makes the group's balances and settlement plan `NaN` for everyone.
  if (!Number.isFinite(amount)) {
    throw createError({ statusCode: 400, message: "Amount must be a finite number." });
  }
  if (!Number.isFinite(amountBase)) {
    throw createError({ statusCode: 400, message: "Invalid converted amount." });
  }
  // A rate that is absent, unparseable, zero, or non-finite means "no
  // conversion", which has always defaulted to 1. Previously the fallback was
  // `Number(rate) || 1`, which let `Infinity` through — `Infinity` is truthy —
  // so an exponential rate was stored verbatim. Falling back to 1 keeps the
  // documented leniency while making a non-finite rate unrepresentable.
  const rawRate = Number(b.exchangeRate);
  const rate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 1;
  if (splitType === "items") {
    let items: { name?: unknown; price?: unknown; members?: unknown }[];
    let tax = 0;
    let tipPercent = 0;
    try {
      const parsed = JSON.parse(description) as {
        items?: unknown;
        tax?: unknown;
        tipPercent?: unknown;
      };
      if (!parsed || !Array.isArray(parsed.items)) throw new Error("bad shape");
      items = parsed.items;
      tax = Number(parsed.tax ?? 0);
      tipPercent = Number(parsed.tipPercent ?? 0);
      if (!Number.isFinite(tax) || tax < 0 || !Number.isFinite(tipPercent) || tipPercent < 0) {
        throw new Error("bad tax/tip");
      }
    } catch {
      throw createError({ statusCode: 400, message: "Invalid items payload." });
    }
    if (!items.length) {
      throw createError({ statusCode: 400, message: "At least one item is required." });
    }
    let itemsTotal = 0;
    for (const it of items) {
      const price = Number(it.price);
      if (
        !it ||
        typeof it.name !== "string" ||
        !it.name.trim() ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        throw createError({
          statusCode: 400,
          message: "Every item needs a name and a price greater than zero.",
        });
      }
      if (!Array.isArray(it.members) || !it.members.length) {
        throw createError({
          statusCode: 400,
          message: "Every item needs at least one person assigned.",
        });
      }
      for (const uid of it.members) {
        if (typeof uid !== "string" || memberIds.indexOf(uid) === -1) {
          throw createError({
            statusCode: 400,
            message: "Item members must be group members.",
          });
        }
      }
      itemsTotal = Math.round((itemsTotal + price) * 100) / 100;
    }
    if (Math.abs(itemsTotal + tax + Math.round(((itemsTotal * tipPercent) / 100) * 100) / 100 - amount) > 0.05) {
      throw createError({
        statusCode: 400,
        message: "Items total does not match the expense total.",
      });
    }
  }
  if (!amount || amount <= 0) {
    throw createError({
      statusCode: 400,
      message: "Amount must be greater than zero.",
    });
  }
  if (!amountBase || amountBase <= 0) {
    throw createError({ statusCode: 400, message: "Invalid converted amount." });
  }
  const paidBy = String(b.paidBy || "");
  if (!paidBy || memberIds.indexOf(paidBy) === -1) {
    throw createError({
      statusCode: 400,
      message: "Payer must be a group member.",
    });
  }
  // The client sends the SELECTION (which type, who takes part, and their
  // input values), never the final amounts. The server recomputes the shares
  // from scratch so a tampered client cannot write an unbalanced ledger.
  const participants = Array.isArray(b.participants)
    ? (b.participants as unknown[]).map(String)
    : [];
  const validParticipants = participants.filter(
    (uid) => memberIds.indexOf(uid) !== -1,
  );
  if (!validParticipants.length) {
    throw createError({
      statusCode: 400,
      message: "At least one participant is required.",
    });
  }

  const values: Record<string, number> = {};
  if (b.values && typeof b.values === "object") {
    for (const uid of Object.keys(b.values as Record<string, unknown>)) {
      if (memberIds.indexOf(uid) === -1) continue;
      const v = Number((b.values as Record<string, unknown>)[uid]);
      if (isFinite(v)) values[uid] = v;
    }
  }

  const computed = computeSplits({
    splitType: splitType as SplitType,
    amountBase: Math.round(amountBase * 100) / 100,
    rate,
    participants: validParticipants,
    memberIds: [...memberIds],
    values,
    items: b.items as ExpenseItem[] | undefined,
  });
  if (!computed.ok) {
    throw createError({ statusCode: 400, message: SPLIT_ERRORS[computed.reason] });
  }
  const splits = computed.splits;
  if (!Object.keys(splits).length) {
    throw createError({
      statusCode: 400,
      message: "At least one participant is required.",
    });
  }
  // Belt-and-braces: every stored share must be a finite number. The finite
  // checks above should make this unreachable, but this is the guard that
  // protects the ledger, so it verifies its own inputs rather than assuming
  // them. A non-finite diff compares false against every threshold, which is
  // precisely how the guard was defeated before.
  const total = round2(amountBase);
  const shareSum = sumSplits(splits);
  const sharesFinite = Object.values(splits).every((v) => Number.isFinite(v));
  if (!sharesFinite || !Number.isFinite(shareSum) || !Number.isFinite(total)) {
    throw createError({
      statusCode: 400,
      message: "Splits did not produce a valid total.",
    });
  }
  if (Math.abs(shareSum - total) > 0.05) {
    throw createError({
      statusCode: 400,
      message: "Splits do not add up to the total.",
    });
  }
  return {
    title,
    description,
    amount: Math.round(amount * 100) / 100,
    currency: String(b.currency || baseCurrency).toUpperCase().slice(0, 3),
    exchangeRate: rate,
    amountBase: Math.round(amountBase * 100) / 100,
    paidBy,
    category: String(b.category || "general").slice(0, 30),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date))
      ? String(b.date)
      : new Date().toISOString().slice(0, 10),
    splitType: String(b.splitType || "equal"),
    splits,
  };
}
