import { requireUser } from "../../../../utils/auth";
import { requireMember, createSettlement } from "../../../../utils/groups";
import { MAX_AMOUNT } from "../../../../../shared/money";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  await requireMember(gid, me.id);
  const b = await readJsonObject(event);

  if (typeof b.from !== "string" || typeof b.to !== "string" || !b.from || !b.to) {
    throw createError({ statusCode: 400, message: "Both people must be group members." });
  }
  if (b.from === b.to) {
    throw createError({ statusCode: 400, message: "Pick two different people." });
  }
  const requestedAmount = b.amount === undefined ? undefined : Number(b.amount);
  if (requestedAmount !== undefined && !Number.isFinite(requestedAmount)) {
    throw createError({ statusCode: 400, message: "Amount must be a finite number." });
  }
  if (requestedAmount !== undefined && requestedAmount > MAX_AMOUNT) {
    throw createError({ statusCode: 400, message: "Amount is too large." });
  }

  return createSettlement(
    gid,
    {
      from: b.from,
      to: b.to,
      amount: requestedAmount,
      note: String(b.note || "").slice(0, 140),
    },
    me.id,
  );
});
