import { requireUser } from "../../../../utils/auth";
import { requireMember, createSettlement } from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  await requireMember(gid, me.id);
  const b = await readBody(event).catch(() => ({}));

  if (!b.from || !b.to) {
    throw createError({ statusCode: 400, message: "Both people must be group members." });
  }
  if (b.from === b.to) {
    throw createError({ statusCode: 400, message: "Pick two different people." });
  }
  const requestedAmount = b.amount === undefined ? undefined : Number(b.amount);
  if (requestedAmount !== undefined && !Number.isFinite(requestedAmount)) {
    throw createError({ statusCode: 400, message: "Amount must be a finite number." });
  }

  return createSettlement(
    gid,
    {
      from: String(b.from),
      to: String(b.to),
      amount: requestedAmount,
      note: String(b.note || "").slice(0, 140),
    },
    me.id,
  );
});
