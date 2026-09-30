export const CURRENCIES = [
  "EUR", "USD", "GBP", "JPY", "CHF", "SEK", "NOK", "DKK", "PLN",
  "CZK", "AUD", "CAD", "INR", "CNY", "MXN", "BRL", "NZD", "SGD", "ZAR",
];

export const SYMBOLS: Record<string, string> = {
  EUR: "€", USD: "$", GBP: "£", JPY: "¥", CHF: "CHF", SEK: "kr",
  NOK: "kr", DKK: "kr", PLN: "zł", CZK: "Kč", AUD: "A$", CAD: "C$",
  INR: "₹", CNY: "¥", MXN: "$", BRL: "R$", NZD: "NZ$", SGD: "S$", ZAR: "R",
};

export function fmt(amount: number, currency: string): string {
  const sym = SYMBOLS[currency] || currency + " ";
  const n = Math.round((amount + Number.EPSILON) * 100) / 100;
  const neg = n < 0;
  const s = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (neg ? "-" : "") + sym + s;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

type TranslateFn = (key: string, ...args: unknown[]) => string;

export function timeAgo(ts: number, t?: TranslateFn): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return t ? t("time.justNow") : "ahora mismo";
  const m = Math.floor(s / 60);
  if (m < 60) return t ? t("time.minutesAgo", m) : `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return t ? t("time.hoursAgo", h) : `hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return t ? t("time.daysAgo", d) : `hace ${d}d`;
  return new Date(ts).toLocaleDateString();
}

export function dateLabel(iso: string, t?: TranslateFn): string {
  const today = todayStr();
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (iso === today) return t ? t("date.today") : "Hoy";
  if (iso === y) return t ? t("date.yesterday") : "Ayer";
  const dt = new Date(iso + "T00:00:00");
  return dt.toLocaleDateString();
}

export interface Expense {
  id: string;
  groupId: string;
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
  createdBy: string;
  createdAt: number;
  splits: Record<string, number>;
}

export interface ExpenseItem {
  name: string;
  price: number;
  members: string[];
}

export interface ItemsData {
  items: ExpenseItem[];
  tax: number;
  tipPercent: number;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Items-split payload carried in the expense description (see ItemsModal).
// Returns null when the description is plain text or malformed.
export function parseItems(description: string): ItemsData | null {
  if (!description || description[0] !== "{") return null;
  try {
    const parsed = JSON.parse(description) as {
      items?: { name?: unknown; price?: unknown; members?: unknown }[];
      tax?: unknown;
      tipPercent?: unknown;
    };
    if (!parsed || !Array.isArray(parsed.items)) return null;
    const items: ExpenseItem[] = parsed.items.map((it) => ({
      name: typeof it.name === "string" ? it.name : "",
      price: typeof it.price === "number" ? it.price : NaN,
      members: Array.isArray(it.members)
        ? it.members.filter((m): m is string => typeof m === "string")
        : [],
    }));
    return { items, tax: num(parsed.tax), tipPercent: num(parsed.tipPercent) };
  } catch {
    return null;
  }
}

// Per-person totals live in shared/splits.ts alongside the split maths that
// consumes them; re-exported here so existing imports keep working.
export { itemsTotals } from "../../shared/splits";

export function itemsTotalPrice(items: ExpenseItem[]): number {
  return Math.round(items.reduce((s, it) => s + (it.price || 0), 0) * 100) / 100;
}

// Distribute `total` proportionally to `weights` (Splitwise tax/tip behavior),
// penny remainder folded into the largest weight. Zero weights get zero.
export function splitProportional(
  total: number,
  weights: Record<string, number>,
  ids: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  ids.forEach((id) => {
    out[id] = 0;
  });
  const wSum = ids.reduce((s, id) => s + (weights[id] || 0), 0);
  if (!(total > 0) || !(wSum > 0)) return out;
  const ordered = [...ids].sort((a, b) => (weights[b] || 0) - (weights[a] || 0));
  let running = 0;
  ordered.forEach((id, i) => {
    const v =
      i === ordered.length - 1
        ? Math.round((total - running) * 100) / 100
        : Math.round(((total * (weights[id] || 0)) / wSum) * 100) / 100;
    running += v;
    out[id] = v;
  });
  return out;
}

export function tipTotalFor(subtotal: number, percent: number): number {
  if (!(subtotal > 0) || !(percent > 0)) return 0;
  return Math.round(((subtotal * percent) / 100) * 100) / 100;
}

export interface Settlement {
  id: string;
  groupId: string;
  from: string;
  to: string;
  amount: number;
  note?: string;
  createdBy: string;
  createdAt: number;
}

export interface RecurringExpense {
  id: string;
  groupId: string;
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
  recurrence: "week" | "month" | "year";
  startDate: string;
  createdBy: string;
  createdAt: number;
}

export interface Profile {
  id: string;
  name: string;
  username: string;
  color: string;
  role: "admin" | "user";
}

export interface Category {
  id: number;
  title: string;
  icon: string;
  translations?: Record<string, string>;
}

export function translatedTitle(
  category: { title: string; translations?: Record<string, string> },
  locale: string,
): string {
  return category.translations?.[locale] || category.title;
}

export interface Group {
  id: string;
  name: string;
  emoji: string;
  baseCurrency: string;
  simplifyTransfers: boolean;
  memberIds: string[];
  createdBy: string;
  createdAt: number;
}
