import { requireUser } from "../../../../utils/auth";
import {
  importExpenses,
  listCategoryIds,
  requireMember,
  type ImportRow,
} from "../../../../utils/groups";
import { canGroupAction } from "../../../../utils/group-permissions";
import { toCents } from "../../../../../shared/money";
import { analyzeSplitwiseCsv } from "../../../../utils/splitwise";
import { readImportRequest } from "../../../../utils/import-input";

/**
 * Commits an import. The CSV is re-parsed here rather than trusting rows from
 * the client, and every expense is written in one transaction, so a bad row
 * can't leave a half-finished import behind.
 */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const group = await requireMember(gid, me.id);
  if (!canGroupAction(me, group, "import")) {
    throw createError({ statusCode: 403, message: "forbidden" });
  }
  // One read of the body: the file and both mapping fields arrive together, and
  // re-reading would re-parse the whole multipart payload each time.
  const { text, fields } = await readImportRequest(event);
  const memberMapping = stringRecord(fields.memberMapping, "bad_memberMapping");
  const categoryMapping = stringRecord(fields.categoryMapping, "bad_categoryMapping");

  const analysis = analyzeSplitwiseCsv(text, group.memberIds.length);
  if (!analysis.total) {
    throw createError({ statusCode: 400, message: "no_data" });
  }
  // Rows are stored with exchange rate 1, so they must already be in the
  // group's base currency; converting would need a rate per row.
  const foreign = analysis.currencies.filter((c) => c !== group.baseCurrency);
  if (foreign.length) {
    throw createError({
      statusCode: 400,
      message: "currency_mismatch",
      data: { expected: group.baseCurrency, got: foreign.join(", ") },
    });
  }

  // Every CSV member must map to a real member of this group, and no two CSV
  // members may claim the same person — the client disables those options, but
  // the mapping is a bijection because the counts are already equal, so
  // duplicates would double someone's share on every expense.
  const claimed = new Set<string>();
  for (const m of analysis.members) {
    const uid = memberMapping[m];
    if (!uid || group.memberIds.indexOf(uid) === -1) {
      throw createError({ statusCode: 400, message: "unmatched_member" });
    }
    if (claimed.has(uid)) {
      throw createError({ statusCode: 400, message: "duplicate_member" });
    }
    claimed.add(uid);
  }
  for (const c of analysis.categories) {
    if (!categoryMapping[c]) {
      throw createError({ statusCode: 400, message: "unmatched_category" });
    }
  }

  const validCategories = new Set(await listCategoryIds());
  for (const c of analysis.categories) {
    const mapped = categoryMapping[c];
    if (!mapped || !validCategories.has(mapped)) {
      throw createError({ statusCode: 400, message: "bad_category" });
    }
  }

  const rows: ImportRow[] = [];
  for (const r of analysis.rows) {
    const splits: Record<string, number> = {};
    for (const csvMember of Object.keys(r.splits)) {
      const groupMember = memberMapping[csvMember];
      const share = r.splits[csvMember];
      // Both mappings are validated above, so these are only guards for the
      // type checker.
      if (!groupMember || share === undefined) continue;
      splits[groupMember] = share;
    }
    const totalCents = Object.values(splits).reduce((a, b) => a + toCents(b), 0);
    if (
      !Object.values(splits).every(Number.isFinite) ||
      totalCents !== toCents(r.amount)
    ) {
      throw createError({ statusCode: 400, message: "splits_mismatch" });
    }
    rows.push({
      title: r.title,
      amount: r.amount,
      currency: r.currency,
      paidBy: memberMapping[r.paidBy] ?? "",
      category: categoryMapping[r.category] || "general",
      date: r.date,
      splits,
    });
  }

  const created = await importExpenses(gid, rows, me.id);
  return { created, skipped: analysis.skipped };
});

function stringRecord(value: unknown, error: string): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createError({ statusCode: 400, message: error });
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") throw createError({ statusCode: 400, message: error });
    out[k] = v;
  }
  return out;
}
