import { requireUser } from "../../utils/auth";
import { requireMember, updateGroup } from "../../utils/groups";
import { readCurrency } from "../../utils/expense-input";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const group = await requireMember(gid, me.id);
  const b = await readJsonObject(event);
  const name = String(b.name ?? group.name).trim().slice(0, 80);
  if (!name) {
    throw createError({ statusCode: 400, message: "A group name is required." });
  }
  const emoji = String(b.emoji ?? group.emoji ?? "🧾").slice(0, 4) || "🧾";
  const baseCurrency = readCurrency(b.baseCurrency, group.baseCurrency);
  const simplifyTransfers =
    typeof b.simplifyTransfers === "boolean" ? b.simplifyTransfers : undefined;
  await updateGroup(gid, me.id, { name, emoji, baseCurrency, simplifyTransfers });
  return { ok: true };
});
