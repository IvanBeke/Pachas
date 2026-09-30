import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  uuid,
} from "drizzle-orm/pg-core";

// Drizzle `casing: 'snake_case'` (nuxt.config.ts) maps these camelCase keys
// to the existing snake_case columns. NUMERIC/BIGINT use number mode to
// preserve the API contract (plain JS numbers, not strings).

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  icon: text("icon").notNull(),
  position: integer("position").notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id),
});

export const categoryTranslations = pgTable(
  "category_translations",
  {
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    title: text("title").notNull(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.locale] })],
);

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  emoji: text("emoji"),
  baseCurrency: text("base_currency").notNull(),
  simplifyTransfers: boolean("simplify_transfers").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("idx_group_members_user").on(t.userId),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    exchangeRate: numeric("exchange_rate", {
      precision: 18,
      scale: 6,
      mode: "number",
    })
      .notNull()
      .default(1),
    amountBase: numeric("amount_base", {
      precision: 14,
      scale: 2,
      mode: "number",
    }).notNull(),
    paidBy: uuid("paid_by")
      .notNull()
      .references(() => users.id),
    category: text("category").notNull().default("general"),
    date: date("date").notNull(),
    splitType: text("split_type").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("idx_expenses_group").on(t.groupId)],
);

export const expenseSplits = pgTable(
  "expense_splits",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.userId] })],
);

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    fromUser: uuid("from_user")
      .notNull()
      .references(() => users.id),
    toUser: uuid("to_user")
      .notNull()
      .references(() => users.id),
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    note: text("note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("idx_settlements_group").on(t.groupId)],
);

export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: uuid("id").primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    exchangeRate: numeric("exchange_rate", {
      precision: 18,
      scale: 6,
      mode: "number",
    })
      .notNull()
      .default(1),
    amountBase: numeric("amount_base", {
      precision: 14,
      scale: 2,
      mode: "number",
    }).notNull(),
    paidBy: uuid("paid_by")
      .notNull()
      .references(() => users.id),
    category: text("category").notNull().default("general"),
    splitType: text("split_type").notNull(),
    splits: jsonb("splits").$type<Record<string, number>>().notNull(),
    recurrence: text("recurrence").notNull(),
    startDate: date("start_date").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("idx_recurring_expenses_group").on(t.groupId)],
);

export const appSessions = pgTable(
  "app_sessions",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("idx_app_sessions_user").on(t.userId),
    index("idx_app_sessions_expires").on(t.expiresAt),
  ],
);
