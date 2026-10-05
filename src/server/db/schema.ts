/**
 * Money columns (`amount`, `amount_base`, and the values inside
 * `recurring_expenses.splits`) hold integer cents. `server/utils/groups.ts`
 * converts to and from decimal units at the boundary; nothing else reads them.
 */
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

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    name: text("name").notNull(),
    locale: text("locale").notNull().default("es"),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("user"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("idx_users_username_lower").on(sql`lower(${t.username})`)],
);

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
  /** Bumped by every write that touches the group; drives the summary ETag. */
  version: integer("version").notNull().default(0),
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
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    exchangeRate: real("exchange_rate")
      .notNull()
      .default(1),
    amountBase: integer("amount_base").notNull(),
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
    /** Set on expenses generated from a recurring template. */
    recurringId: text("recurring_id").references(() => recurringExpenses.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("idx_expenses_group_date").on(t.groupId, t.date, t.createdAt),
    index("idx_expenses_category").on(t.category),
    index("idx_expenses_paid_by").on(t.paidBy),
    index("idx_expenses_created_by").on(t.createdBy),
    uniqueIndex("idx_expenses_recurring_date")
      .on(t.recurringId, t.date)
      .where(sql.raw(`"recurring_id" IS NOT NULL`)),
  ],
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
    amount: integer("amount").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.userId] }),
    index("idx_expense_splits_user").on(t.userId),
  ],
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
    amount: integer("amount").notNull(),
    note: text("note"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_settlements_group_created").on(t.groupId, t.createdAt),
    index("idx_settlements_from").on(t.fromUser),
    index("idx_settlements_to").on(t.toUser),
    index("idx_settlements_created_by").on(t.createdBy),
  ],
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
    amount: integer("amount").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.settlementId, t.debtorId, t.creditorId] }),
    index("idx_settlement_allocations_pair").on(t.debtorId, t.creditorId),
    index("idx_settlement_allocations_creditor").on(t.creditorId),
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
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    exchangeRate: real("exchange_rate")
      .notNull()
      .default(1),
    amountBase: integer("amount_base").notNull(),
    paidBy: text("paid_by")
      .notNull()
      .references(() => users.id),
    category: text("category").notNull().default("general"),
    splitType: text("split_type").notNull(),
    splits: text("splits", { mode: "json" }).$type<Record<string, number>>().notNull(),
    recurrence: text("recurrence").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    /**
     * Every occurrence on or before this date has been generated (or
     * deliberately skipped). `null` means nothing has been generated yet.
     */
    generatedThrough: text("generated_through"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_recurring_expenses_group_created").on(t.groupId, t.createdAt),
    index("idx_recurring_expenses_paid_by").on(t.paidBy),
    index("idx_recurring_expenses_created_by").on(t.createdBy),
    index("idx_recurring_expenses_category").on(t.category),
  ],
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
