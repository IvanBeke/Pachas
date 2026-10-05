import { requireUser } from "../../../../utils/auth";
import { requireMember } from "../../../../utils/groups";
import { canGroupAction } from "../../../../utils/group-permissions";
import { analyzeSplitwiseCsv } from "../../../../utils/splitwise";
import { readImportRequest } from "../../../../utils/import-input";

/**
 * Dry run: parses the uploaded export and reports what an import would do,
 * without writing anything. Lets the client show member/category matching
 * and a preview while all parsing stays on the server.
 */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const group = await requireMember(gid, me.id);
  if (!canGroupAction(me, group, "import")) {
    throw createError({ statusCode: 403, message: "forbidden" });
  }
  const { text } = await readImportRequest(event);

  const analysis = analyzeSplitwiseCsv(text, group.memberIds.length);
  const foreign = analysis.currencies.filter((c) => c !== group.baseCurrency);
  if (foreign.length) {
    throw createError({
      statusCode: 400,
      message: "currency_mismatch",
      data: { expected: group.baseCurrency, got: foreign.join(", ") },
    });
  }
  return {
    members: analysis.members,
    categories: analysis.categories,
    currencies: analysis.currencies,
    total: analysis.total,
    skipped: analysis.skipped,
    totalAmount: analysis.totalAmount,
    // Enough for a preview without shipping thousands of rows to the browser.
    sample: analysis.rows.slice(0, 50),
  };
});
