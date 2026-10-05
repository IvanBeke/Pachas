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
  /** Set when the expense was generated from a recurring template. */
  recurringId?: string | null;
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
  endDate: string | null;
  createdBy: string;
  createdAt: number;
}

export interface Profile {
  id: string;
  name: string;
  username: string;
  locale: "es" | "en";
  color: string;
  /** Only present on the signed-in user's own profile. */
  role?: "admin" | "user";
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
  members: { userId: string; role: import("../../shared/group-roles").GroupRole }[];
  createdBy: string;
  createdAt: number;
  /** Increments on every change to the group's data. */
  version?: number;
}
