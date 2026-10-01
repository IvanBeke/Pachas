import { requireUser } from "../../utils/auth";
import { countExpenses, requireMember, updateGroup } from "../../utils/groups";
import { canGroupAction } from "../../utils/group-permissions";

/** Only the group's creator or an admin may edit group settings. */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const group = await requireMember(gid, me.id);
  if (!canGroupAction(me, group, "group.settings.update")) {
    throw createError({ statusCode: 403, message: "forbidden" });
  }
  const b = await readBody(event).catch(() => ({}));
  const name = String(b.name ?? group.name).trim().slice(0, 80);
  if (!name) {
    throw createError({ statusCode: 400, message: "A group name is required." });
  }
  const emoji = String(b.emoji ?? group.emoji ?? "🧾").slice(0, 4) || "🧾";
  const baseCurrency =
    String(b.baseCurrency ?? group.baseCurrency).toUpperCase().slice(0, 3) ||
    group.baseCurrency;
  // `amountBase` is denormalised into every expense row, so changing the base
  // currency after expenses exist would silently reinterpret the whole
  // historical ledger with no conversion applied. Frozen once money is in.
  if (baseCurrency !== group.baseCurrency) {
    const count = await countExpenses(gid);
    if (count > 0) {
      throw createError({
        statusCode: 409,
        message:
          "The base currency cannot be changed once the group has expenses.",
      });
    }
  }
  const simplifyTransfers =
    typeof b.simplifyTransfers === "boolean"
      ? b.simplifyTransfers
      : group.simplifyTransfers;
  await updateGroup(gid, { name, emoji, baseCurrency, simplifyTransfers });
  return { ok: true };
});
