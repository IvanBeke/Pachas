import { requireUser } from "../../../../utils/auth";
import { requireMember, createSettlement, getBalances } from "../../../../utils/groups";

/** Half a cent, matching the float guards in the balance maths. */
const EPSILON = 0.005;

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const group = await requireMember(gid, me.id);
  const b = await readBody(event).catch(() => ({}));

  if (!b.from || !b.to) {
    throw createError({ statusCode: 400, message: "Both people must be group members." });
  }
  if (b.from === b.to) {
    throw createError({ statusCode: 400, message: "Pick two different people." });
  }
  if (group.memberIds.indexOf(b.from) === -1 || group.memberIds.indexOf(b.to) === -1) {
    throw createError({ statusCode: 400, message: "Both people must be group members." });
  }

  // The payer of the settlement (b.from) must currently owe the receiver
  // (b.to) money, and the amount is capped by that outstanding debt. Deriving
  // this server-side is what stops a client inventing or inflating a
  // settlement, which would otherwise silently rewrite everyone's balance.
  const balances = await getBalances(gid);
  const fromBal = balances.find((x) => x.memberId === b.from);
  const toBal = balances.find((x) => x.memberId === b.to);
  const owed = -(fromBal?.amount ?? 0);
  const receivable = toBal?.amount ?? 0;
  if (owed <= EPSILON || receivable <= EPSILON) {
    throw createError({
      statusCode: 400,
      message: "There is no outstanding debt between these two.",
    });
  }

  const requested = Number(b.amount);
  const hasAmount = requested !== undefined && !Number.isNaN(requested);
  const amount = Math.round((hasAmount ? requested : Math.min(owed, receivable)) * 100) / 100;

  if (!amount || amount <= 0) {
    throw createError({ statusCode: 400, message: "Amount must be greater than zero." });
  }
  if (amount - Math.min(owed, receivable) > EPSILON) {
    throw createError({
      statusCode: 400,
      message: "Amount is more than the outstanding debt.",
    });
  }

  const sid = await createSettlement(
    gid,
    { from: b.from, to: b.to, amount, note: String(b.note || "").slice(0, 140) },
    me.id,
  );
  return { id: sid, amount };
});
