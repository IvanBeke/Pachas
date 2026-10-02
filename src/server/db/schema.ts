import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { GroupRole } from "../../shared/group-roles";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  createdAt: integer("created_at").notNull(),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  icon: text("icon").notNull(),
  position: integer("position").notNull().default(0),
  createdBy: text("created_by").references(() => users.id),
});

export const categoryTranslations = sqliteTable(
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

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  emoji: text("emoji"),
  baseCurrency: text("base_currency").notNull(),
  simplifyTransfers: integer("simplify_transfers", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").references(() => users.id),
  createdAt: integer("created_at").notNull(),
});

export const groupMembers = sqliteTable(
  "group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", {
      enum: [GroupRole.Creator, GroupRole.Admin, GroupRole.Member],
    })
      .notNull()
      .default(GroupRole.Member),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("idx_group_members_user").on(t.userId),
    uniqueIndex("idx_group_members_creator")
      .on(t.groupId)
      .where(sql.raw(`"role" = 'creator'`)),
  ],
);

export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    description: text("description").notNull(),
    amount: real("amount").notNull(),
    currency: text("currency").notNull(),
    exchangeRate: real("exchange_rate")
      .notNull()
      .default(1),
    amountBase: real("amount_base").notNull(),
    paidBy: text("paid_by")
      .notNull()
      .references(() => users.id),
    category: text("category").notNull().default("general"),
    date: text("date").notNull(),
    splitType: text("split_type").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_expenses_group").on(t.groupId)],
);

export const expenseSplits = sqliteTable(
  "expense_splits",
  {
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: real("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.userId] })],
);

export const settlements = sqliteTable(
  "settlements",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    fromUser: text("from_user")
      .notNull()
      .references(() => users.id),
    toUser: text("to_user")
      .notNull()
      .references(() => users.id),
    amount: real("amount").notNull(),
    note: text("note"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_settlements_group").on(t.groupId)],
);

export const settlementAllocations = sqliteTable(
  "settlement_allocations",
  {
    settlementId: text("settlement_id")
      .notNull()
      .references(() => settlements.id, { onDelete: "cascade" }),
    debtorId: text("debtor_id")
      .notNull()
      .references(() => users.id),
    creditorId: text("creditor_id")
      .notNull()
      .references(() => users.id),
    amount: real("amount").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.settlementId, t.debtorId, t.creditorId] }),
    index("idx_settlement_allocations_pair").on(t.debtorId, t.creditorId),
  ],
);

export const recurringExpenses = sqliteTable(
  "recurring_expenses",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    description: text("description").notNull(),
    amount: real("amount").notNull(),
    currency: text("currency").notNull(),
    exchangeRate: real("exchange_rate")
      .notNull()
      .default(1),
    amountBase: real("amount_base").notNull(),
    paidBy: text("paid_by")
      .notNull()
      .references(() => users.id),
    category: text("category").notNull().default("general"),
    splitType: text("split_type").notNull(),
    splits: text("splits", { mode: "json" }).$type<Record<string, number>>().notNull(),
    recurrence: text("recurrence").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_recurring_expenses_group").on(t.groupId)],
);

export const appSessions = sqliteTable(
  "app_sessions",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    index("idx_app_sessions_user").on(t.userId),
    index("idx_app_sessions_expires").on(t.expiresAt),
  ],
);
