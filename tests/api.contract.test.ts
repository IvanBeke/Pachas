import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSplits, round2, splitsToInputValues, type SplitType } from "../app/utils/splits";

/**
 * Contract tests: the server must treat the client as untrusted and never
 * accept client-computed amounts. These exercise the real route handlers.
 *
 * The group is created per run from real users (membership is validated
 * against real rows), so the suite is self-contained and repeatable.
 */
const BASE = process.env.PACHAS_API ?? "http://localhost:3000";
const GROUP_NAME = "__contract__";

/** Skip the whole suite when there is no server to talk to (e.g. in CI). */
const reachable = await fetch(`${BASE}/api/health`)
  .then((r) => r.ok)
  .catch(() => false);

async function login(username: string, password: string) {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${username}: ${res.status}`);
  return {
    cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "",
    me: (await res.json()) as { id: string },
  };
}

/** Unique-per-run suffix so repeated runs never collide on usernames. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

async function register(username: string, password: string) {
  const res = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, name: username }),
  });
  if (!res.ok) {
    throw new Error(
      `register failed for ${username}: ${res.status} (is ALLOW_REGISTRATION on?)`,
    );
  }
  return login(username, password);
}

async function api(cookie: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = text as unknown as Record<string, unknown>;
  }
  return { status: res.status, json };
}

type ExpenseRow = {
  id: string;
  title: string;
  amountBase: number;
  splits: Record<string, number>;
};

describe.skipIf(!reachable)("server-authoritative split computation", () => {
  let cookie: string;
  let gid: string;
  let memberA: string;
  let memberB: string;

  beforeAll(async () => {
    const creator = await register(`own${RUN}splitcreator`, "split-pass-123");
    cookie = creator.cookie;
    memberA = creator.me.id;

    const found = await api(cookie, "GET", "/api/users/search?q=be");
    const other = (found.json as { id: string }[])[0];
    if (!other) throw new Error("no second user available for the contract test");
    memberB = other.id;

    const created = await api(cookie, "POST", "/api/groups", {
      name: GROUP_NAME,
      baseCurrency: "EUR",
      memberIds: [memberA, memberB],
    });
    gid = String(created.json.id);
  });

  afterAll(async () => {
    if (!cookie || !gid) return;
    // These older split-contract groups are pruned by the standardized
    // cleanup query after the API suite; see AGENTS.md.
    for (const e of (await listExpenses())) {
      await api(cookie, "DELETE", `/api/groups/${gid}/expenses/${e.id}`);
    }
  });

  /** The body the client sends: a selection, never the amounts. */
  const selection = (over: Record<string, unknown> = {}) => ({
    title: "contract",
    amount: 30,
    amountBase: 30,
    currency: "EUR",
    exchangeRate: 1,
    paidBy: memberA,
    category: "1",
    date: "2026-09-28",
    splitType: "equal",
    participants: [memberA, memberB],
    ...over,
  });

  const listExpenses = async () => {
    const r = await api(cookie, "GET", `/api/groups/${gid}/expenses`);
    return r.json as unknown as ExpenseRow[];
  };

  const byTitle = async (title: string) =>
    (await listExpenses()).find((e) => e.title === title);

  it("computes an equal split from the participant list alone", async () => {
    const r = await api(cookie, "POST", `/api/groups/${gid}/expenses`, selection());
    expect(r.status).toBe(200);
  });

  it("ignores client-supplied splits and recomputes them", async () => {
    // A tampered client claims one person owes everything.
    const r = await api(
      cookie,
      "POST",
      `/api/groups/${gid}/expenses`,
      selection({ title: "tampered", splits: { [memberA]: 30, [memberB]: 0 } }),
    );
    expect(r.status).toBe(200);
    const row = await byTitle("tampered");
    expect(row?.splits).toEqual({ [memberA]: 15, [memberB]: 15 });
  });

  it("rejects a payload with no participants", async () => {
    const r = await api(cookie, "POST", `/api/groups/${gid}/expenses`,
      selection({ participants: [] }));
    expect(r.status).toBe(400);
  });

  it("rejects a participant who is not in the group", async () => {
    const r = await api(cookie, "POST", `/api/groups/${gid}/expenses`,
      selection({ participants: ["00000000-0000-0000-0000-000000000000"] }));
    expect(r.status).toBe(400);
  });

  it("rejects percentages that do not total 100", async () => {
    const r = await api(cookie, "POST", `/api/groups/${gid}/expenses`,
      selection({ splitType: "percent", values: { [memberA]: 50, [memberB]: 20 } }));
    expect(r.status).toBe(400);
  });

  it("rejects exact amounts that miss the total", async () => {
    const r = await api(cookie, "POST", `/api/groups/${gid}/expenses`,
      selection({ splitType: "exact", values: { [memberA]: 5, [memberB]: 1 } }));
    expect(r.status).toBe(400);
  });

  it("rejects shares with no weight", async () => {
    const r = await api(cookie, "POST", `/api/groups/${gid}/expenses`,
      selection({ splitType: "shares", values: { [memberA]: 0, [memberB]: 0 } }));
    expect(r.status).toBe(400);
  });

  it("stores splits that reconcile to the amount", async () => {
    for (const row of await listExpenses()) {
      const sum = round2(Object.values(row.splits).reduce((x, y) => x + y, 0));
      expect(Math.abs(sum - row.amountBase)).toBeLessThan(0.005);
    }
  });

  it("the client preview and the stored result agree", async () => {
    // Same shared code on both sides, so what the user saw is what is saved.
    const input = {
      splitType: "percent" as SplitType,
      amountBase: 30,
      participants: [memberA, memberB],
      memberIds: [memberA, memberB],
      values: { [memberA]: 70, [memberB]: 30 },
    };
    const preview = computeSplits(input);
    expect(preview.ok).toBe(true);

    const r = await api(cookie, "POST", `/api/groups/${gid}/expenses`,
      selection({ title: "percent preview", splitType: "percent", values: input.values }));
    expect(r.status).toBe(200);

    // The list is date-descending, so find the row by title rather than index.
    const row = await byTitle("percent preview");
    expect(row?.splits).toEqual(preview.ok ? preview.splits : {});
  });

  it("percent edit pre-fill reconstructs valid percentages", async () => {
    // The bug this guards: a 50/50 split of 30 is stored as 15/15, and pasting
    // those into percent inputs renders "15%" and fails the form's own check.
    const pct = splitsToInputValues({ [memberA]: 15, [memberB]: 15 }, 30, "percent");
    expect(Object.values(pct).reduce((x, y) => x + y, 0)).toBeCloseTo(100, 1);
  });
});

describe.skipIf(!reachable)("expense deletion authorisation", () => {
  let ownerCookie: string;
  let otherCookie: string;
  let ownerId: string;
  let otherId: string;
  let gid: string;

  beforeAll(async () => {
    // Two freshly registered plain users, so "owner" and "other" are not
    // admins and the only admin in play is the one logging in as admin.
    // Registering keeps the suite self-contained instead of depending on
    // whatever accounts happen to exist.
    const a = await register(`own${RUN}`, "owner-pass-1");
    ownerCookie = a.cookie;
    ownerId = a.me.id;
    const b = await register(`oth${RUN}`, "other-pass-1");
    otherCookie = b.cookie;
    otherId = b.me.id;

    const created = await api(ownerCookie, "POST", "/api/groups", {
      name: `__delete_contract__${RUN}`,
      baseCurrency: "EUR",
      memberIds: [ownerId, otherId],
    });
    gid = String(created.json.id);
  });

  afterAll(async () => {
    if (!ownerCookie || !gid) return;
    for (const e of await listExpenses(ownerCookie)) {
      await api(ownerCookie, "DELETE", `/api/groups/${gid}/expenses/${e.id}`);
    }
  });

  const listExpenses = async (cookie: string) => {
    const r = await api(cookie, "GET", `/api/groups/${gid}/expenses`);
    return r.json as unknown as ExpenseRow[];
  };

  /** Create an expense owned by `ownerId`, via that user's own session. */
  const createOwned = async (title: string) => {
    const r = await api(ownerCookie, "POST", `/api/groups/${gid}/expenses`, {
      title,
      amount: 10,
      amountBase: 10,
      currency: "EUR",
      paidBy: ownerId,
      category: "1",
      date: "2026-09-28",
      splitType: "equal",
      participants: [ownerId, otherId],
    });
    expect(r.status).toBe(200);
    return String(r.json.id);
  };

  const createOtherOwned = async (title: string) => {
    const r = await api(otherCookie, "POST", `/api/groups/${gid}/expenses`, {
      title,
      amount: 10,
      amountBase: 10,
      currency: "EUR",
      paidBy: otherId,
      category: "1",
      date: "2026-09-28",
      splitType: "equal",
      participants: [ownerId, otherId],
    });
    expect(r.status).toBe(200);
    return String(r.json.id);
  };

  it("lets the creator delete their own expense", async () => {
    const id = await createOwned("own delete");
    const r = await api(ownerCookie, "DELETE", `/api/groups/${gid}/expenses/${id}`);
    expect(r.status).toBe(200);
    expect((await listExpenses(ownerCookie)).some((e) => e.id === id)).toBe(false);
  });

  it("lets the group creator delete another member's expense", async () => {
    const id = await createOtherOwned("creator deletes this");
    const r = await api(ownerCookie, "DELETE", `/api/groups/${gid}/expenses/${id}`);
    expect(r.status).toBe(200);
    expect((await listExpenses(ownerCookie)).some((e) => e.id === id)).toBe(false);
  });

  it("stops a plain member deleting someone else's expense", async () => {
    const id = await createOwned("not yours");
    const r = await api(otherCookie, "DELETE", `/api/groups/${gid}/expenses/${id}`);
    // 404 rather than 403, so the response doesn't confirm the row exists.
    expect(r.status).toBe(404);
    expect((await listExpenses(ownerCookie)).some((e) => e.id === id)).toBe(true);
    await api(ownerCookie, "DELETE", `/api/groups/${gid}/expenses/${id}`);
  });

  it("stops a non-member deleting an expense", async () => {
    const id = await createOwned("outsider");
    const stranger = await register(`str${RUN}`, "stranger-pass-1");
    const r = await api(stranger.cookie, "DELETE", `/api/groups/${gid}/expenses/${id}`);
    expect([403, 404]).toContain(r.status);
    expect((await listExpenses(ownerCookie)).some((e) => e.id === id)).toBe(true);
    await api(ownerCookie, "DELETE", `/api/groups/${gid}/expenses/${id}`);
  });

  it("requires authentication", async () => {
    const id = await createOwned("anon");
    const r = await api("", "DELETE", `/api/groups/${gid}/expenses/${id}`);
    expect(r.status).toBe(401);
    await api(ownerCookie, "DELETE", `/api/groups/${gid}/expenses/${id}`);
  });

  it("issues a random bearer cookie and revokes it on logout", async () => {
    // The cookie is the raw 32-byte token, never the digest we store.
    const session = await register(`own${RUN}sess`, "sess-pass-123");
    const token = session.cookie.split("=")[1] ?? "";
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // Authenticates.
    const me = await api(session.cookie, "GET", "/api/me");
    expect(me.status).toBe(200);

    // A tampered cookie must not authenticate.
    const forged = await api(
      `pachas.sid=${token.slice(0, 63)}f`,
      "GET",
      "/api/me",
    );
    expect(forged.status).toBe(401);

    // Logout must actually delete the row. If `destroySession` forgot to
    // digest the token, the delete would match nothing, the row would
    // survive, and replaying the captured cookie would still authenticate —
    // the exact bug this test exists to catch.
    const out = await api(session.cookie, "POST", "/api/logout");
    expect(out.status).toBe(200);

    const replay = await api(session.cookie, "GET", "/api/me");
    expect(replay.status).toBe(401);
  });

  it("treats a malformed percent-encoded cookie as absent, not a crash", async () => {
    // `decodeURIComponent("%")` throws a URIError. This ran inside the session
    // lookup on every request, so `Cookie: pachas.sid=%` turned every
    // authenticated route into an unhandled 500 — unauthenticated, one request.
    for (const bad of ["%", "%zz", "abc%"]) {
      const r = await api(`pachas.sid=${bad}`, "GET", "/api/me");
      expect(r.status, `cookie value ${JSON.stringify(bad)}`).toBe(401);
    }
  });

  it("rate limits repeated failed logins", async () => {
    // The DoS finding: bcryptjs is pure JS, so each synchronous compare blocked
    // the event loop ~48ms. With no limiter, ~20 req/s from one connection
    // saturated the server.
    //
    // Deliberately stops at the per-account limit (10) rather than running
    // enough attempts to saturate the per-IP bucket — the limiter is process
    // state shared by the whole suite, so overshooting would lock out every
    // later login in this run and in the next few.
    const username = `own${RUN}brute`;
    let sawRateLimit = false;
    for (let i = 0; i < 15; i++) {
      const res = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: `wrong-${i}` }),
      });
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
      expect(res.status, `attempt ${i}`).toBe(401);
    }
    expect(sawRateLimit, "expected a 429 after repeated failures").toBe(true);
  });

  it("does not rate limit a successful login on a fresh account", async () => {
    // Guards the other half of the design: only failures are recorded, so a
    // legitimate user signing in repeatedly — which is exactly what this suite
    // does — never exhausts a bucket. A regression that counted successes would
    // make the suite self-throttle.
    const username = `own${RUN}ok`;
    const created = await register(username, "repeat-pass-123");
    expect(created.cookie.length).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) {
      const again = await login(username, "repeat-pass-123");
      expect(again.me.id).toBe(created.me.id);
    }
  });

  it("serves security headers and hides the framework", async () => {
    const res = await fetch(`${BASE}/`);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    // Empty header removes the value rather than advertising the framework.
    expect(res.headers.get("x-powered-by")).toBeFalsy();
  });

  it("rejects a poisoned amount instead of writing NaN to the ledger", async () => {
    // The integrity finding: `amount: 1e400` is `Infinity`, which passed the
    // `!amount || amount <= 0` guard, produced `{Infinity, NaN}` splits, and
    // then defeated the reconciliation check because every comparison against
    // `NaN` is false.
    const r = await api(ownerCookie, "POST", `/api/groups/${gid}/expenses`, {
      title: "Poison",
      amount: "1e400",
      amountBase: "1e400",
      paidBy: ownerId,
      participants: [ownerId, otherId],
      splitType: "equal",
    });
    expect(r.status).toBe(400);
  });

  it("lets any group member add another member with the member role", async () => {
    const outsider = await register(`oth${RUN}add`, "add-pass-123");

    // A group owned by `owner`, with `other` as an ordinary member.
    const created = await api(ownerCookie, "POST", "/api/groups", {
      name: `${GROUP_NAME}add`,
      baseCurrency: "EUR",
      memberIds: [ownerId, otherId],
    });
    const addGid = String(created.json.id);

    // `other` is a plain member, not the creator, and may still add someone.
    const asMember = await api(
      otherCookie,
      "POST",
      `/api/groups/${addGid}/members`,
      { userId: outsider.me.id },
    );
    expect(asMember.status).toBe(200);
    expect((asMember.json as { members: { userId: string; role: string }[] }).members)
      .toContainEqual({ userId: outsider.me.id, role: "member" });

    // The creator may.
    const asCreator = await api(
      ownerCookie,
      "POST",
      `/api/groups/${addGid}/members`,
      { userId: outsider.me.id },
    );
    expect(asCreator.status).toBe(200);
  });

  it("lets a member leave but prevents removing other members or the creator", async () => {
    const created = await api(ownerCookie, "POST", "/api/groups", {
      name: `${GROUP_NAME}leave`,
      baseCurrency: "EUR",
      memberIds: [ownerId, otherId],
    });
    const leaveGid = String(created.json.id);

    const removeOther = await api(
      otherCookie,
      "DELETE",
      `/api/groups/${leaveGid}/members/${ownerId}`,
    );
    expect(removeOther.status).toBe(403);

    // A plain member may leave themselves.
    const self = await api(
      otherCookie,
      "DELETE",
      `/api/groups/${leaveGid}/members/${otherId}`,
    );
    expect(self.status).toBe(200);

    // The creator still cannot, or the group would be unadministrable.
    const creatorOut = await api(
      ownerCookie,
      "DELETE",
      `/api/groups/${leaveGid}/members/${ownerId}`,
    );
    expect(creatorOut.status).toBe(400);
  });

  it("freezes the base currency once the group has expenses", async () => {
    // `amountBase` is denormalised into every expense row, so switching
    // currency would silently reinterpret the whole ledger with no conversion.
    const created = await api(ownerCookie, "POST", "/api/groups", {
      name: `${GROUP_NAME}ccy`,
      baseCurrency: "EUR",
      memberIds: [ownerId, otherId],
    });
    const ccyGid = String(created.json.id);

    // Before any expense, changing it is allowed.
    const early = await api(ownerCookie, "PATCH", `/api/groups/${ccyGid}`, {
      baseCurrency: "USD",
    });
    expect(early.status).toBe(200);
    await api(ownerCookie, "PATCH", `/api/groups/${ccyGid}`, { baseCurrency: "EUR" });

    await api(ownerCookie, "POST", `/api/groups/${ccyGid}/expenses`, {
      title: "Seed",
      amount: 10,
      amountBase: 10,
      paidBy: ownerId,
      participants: [ownerId, otherId],
      splitType: "equal",
    });

    const late = await api(ownerCookie, "PATCH", `/api/groups/${ccyGid}`, {
      baseCurrency: "USD",
    });
    expect(late.status).toBe(409);
  });

  it("does not let a wildcard query dump the user directory", async () => {
    // The query was passed into ILIKE unescaped, so wildcards became patterns.
    // These are two-character queries, which clears the minimum-length check —
    // a one-character `%` is rejected as too short and never reaches ILIKE, so
    // testing only that would prove nothing about the escaping.
    for (const q of ["%25%25", "__", "_%"]) {
      const r = await api(ownerCookie, "GET", `/api/users/search?q=${q}`);
      expect(r.status, `q=${q}`).toBe(200);
      expect(
        Array.isArray(r.json) ? r.json.length : -1,
        `wildcard q=${q} must match nobody`,
      ).toBe(0);
    }

    // Too short to search on.
    const short = await api(ownerCookie, "GET", "/api/users/search?q=a");
    expect(Array.isArray(short.json) ? short.json.length : 0).toBe(0);

    // A real prefix still works, so the fix did not break the feature.
    const real = await api(ownerCookie, "GET", "/api/users/search?q=be");
    expect(Array.isArray(real.json) ? real.json.length : 0).toBeGreaterThan(0);
  });

  it("returns 404 for an expense that does not exist", async () => {
    const r = await api(ownerCookie, "DELETE",
      `/api/groups/${gid}/expenses/00000000-0000-0000-0000-000000000000`);
    expect(r.status).toBe(404);
  });

  it("does not let a group creator act across groups", async () => {
    const id = await createOwned("scoped");
    const other = await api(ownerCookie, "POST", "/api/groups", {
      name: `__delete_elsewhere__${RUN}`,
      baseCurrency: "EUR",
      memberIds: [ownerId],
    });
    const r = await api(ownerCookie, "DELETE",
      `/api/groups/${other.json.id as string}/expenses/${id}`);
    // This user created the first group but isn't a member of the other one,
    // so the membership check rejects the cross-group request.
    expect([403, 404]).toContain(r.status);
    expect((await listExpenses(ownerCookie)).some((e) => e.id === id)).toBe(true);
    await api(ownerCookie, "DELETE", `/api/groups/${gid}/expenses/${id}`);
  });
});

describe.skipIf(!reachable)("group role authorisation", () => {
  let creatorCookie: string;
  let memberCookie: string;
  let adminCookie: string;
  let candidateCookie: string;
  let outsiderCookie: string;
  let unaffiliatedCookie: string;
  let creatorId: string;
  let memberId: string;
  let adminId: string;
  let candidateId: string;
  let outsiderId: string;
  let gid: string;

  beforeAll(async () => {
    const creator = await register(`own${RUN}rolecreator`, "creator-pass-1");
    const member = await register(`oth${RUN}rolemember`, "member-pass-1");
    const admin = await register(`own${RUN}roleadmin`, "admin-pass-1");
    const candidate = await register(`oth${RUN}rolecandidate`, "candidate-pass-1");
    const outsider = await register(`own${RUN}roleoutsider`, "outsider-pass-1");
    const unaffiliated = await register(`oth${RUN}roleunaffiliated`, "unaffiliated-pass-1");
    creatorCookie = creator.cookie;
    creatorId = creator.me.id;
    memberCookie = member.cookie;
    memberId = member.me.id;
    adminCookie = admin.cookie;
    adminId = admin.me.id;
    candidateCookie = candidate.cookie;
    candidateId = candidate.me.id;
    outsiderCookie = outsider.cookie;
    outsiderId = outsider.me.id;
    unaffiliatedCookie = unaffiliated.cookie;

    const created = await api(creatorCookie, "POST", "/api/groups", {
      name: `__roles_contract__${RUN}`,
      baseCurrency: "EUR",
      memberIds: [memberId, adminId, candidateId],
    });
    gid = String(created.json.id);
    const promoted = await api(
      creatorCookie,
      "PATCH",
      `/api/groups/${gid}/members/${adminId}`,
      { role: "admin" },
    );
    expect(promoted.status).toBe(200);
  });

  afterAll(async () => {
    if (!creatorCookie || !gid) return;
    const group = await api(creatorCookie, "GET", `/api/groups/${gid}`);
    if (group.status === 200) {
      await api(creatorCookie, "DELETE", `/api/groups/${gid}`);
    }
  });

  const expenseInput = (title: string, paidBy = creatorId) => ({
    title,
    amount: 20,
    amountBase: 20,
    currency: "EUR",
    exchangeRate: 1,
    paidBy,
    category: "1",
    date: "2026-09-28",
    splitType: "equal",
    participants: [creatorId, memberId],
  });

  it("assigns creator/member roles during group creation", async () => {
    const result = await api(creatorCookie, "GET", `/api/groups/${gid}`);
    const group = result.json as {
      createdBy: string;
      members: { userId: string; role: string }[];
    };
    expect(group.members).toContainEqual({ userId: creatorId, role: "creator" });
    expect(group.members).toContainEqual({ userId: memberId, role: "member" });
    expect(group.members).toContainEqual({ userId: adminId, role: "admin" });
    expect(group.createdBy).toBe(creatorId);
  });

  it("allows members to add members, always with the member role", async () => {
    const added = await api(
      memberCookie,
      "POST",
      `/api/groups/${gid}/members`,
      { userId: outsiderId, role: "admin" },
    );
    expect(added.status).toBe(200);
    expect((added.json as { members: { userId: string; role: string }[] }).members)
      .toContainEqual({ userId: outsiderId, role: "member" });
  });

  it("requires group membership before group-level actions", async () => {
    expect((await api(unaffiliatedCookie, "GET", `/api/groups/${gid}`)).status).toBe(403);
    expect((await api(unaffiliatedCookie, "PATCH", `/api/groups/${gid}`, { name: "forged" })).status)
      .toBe(403);
    expect((await api(unaffiliatedCookie, "DELETE", `/api/groups/${gid}`)).status).toBe(403);
  });

  it("allows only creator/admin to change settings and import", async () => {
    expect((await api(memberCookie, "PATCH", `/api/groups/${gid}`, { name: "nope" })).status)
      .toBe(403);
    expect((await api(memberCookie, "POST", `/api/groups/${gid}/import/analyze`)).status)
      .toBe(403);
    expect((await api(adminCookie, "PATCH", `/api/groups/${gid}`, { name: "role admin" })).status)
      .toBe(200);
  });

  it("lets admins promote non-creators but not transfer the creator role", async () => {
    const promote = await api(
      adminCookie,
      "PATCH",
      `/api/groups/${gid}/members/${candidateId}`,
      { role: "admin" },
    );
    expect(promote.status).toBe(200);
    expect((promote.json as { members: { userId: string; role: string }[] }).members)
      .toContainEqual({ userId: candidateId, role: "admin" });

    const transfer = await api(
      adminCookie,
      "PATCH",
      `/api/groups/${gid}/members/${candidateId}`,
      { role: "creator" },
    );
    expect(transfer.status).toBe(403);
  });

  it("limits expense edits/deletes to their creator, group admin, or group creator", async () => {
    const created = await api(
      memberCookie,
      "POST",
      `/api/groups/${gid}/expenses`,
      expenseInput("member-owned"),
    );
    expect(created.status).toBe(200);
    const eid = String(created.json.id);

    expect((await api(memberCookie, "PATCH", `/api/groups/${gid}/expenses/${eid}`, expenseInput("member-edit"))).status)
      .toBe(200);

    const createdByMember = await api(
      memberCookie,
      "POST",
      `/api/groups/${gid}/expenses`,
      expenseInput("another-member-owned"),
    );
    const otherEid = String(createdByMember.json.id);
    expect((await api(adminCookie, "PATCH", `/api/groups/${gid}/expenses/${otherEid}`, expenseInput("admin-edit"))).status)
      .toBe(200);

    const ownedByCreator = await api(
      creatorCookie,
      "POST",
      `/api/groups/${gid}/expenses`,
      expenseInput("creator-owned"),
    );
    const creatorEid = String(ownedByCreator.json.id);
    expect((await api(memberCookie, "PATCH", `/api/groups/${gid}/expenses/${creatorEid}`, expenseInput("forbidden-edit"))).status)
      .toBe(404);
    expect((await api(memberCookie, "DELETE", `/api/groups/${gid}/expenses/${creatorEid}`)).status)
      .toBe(404);
    expect((await api(creatorCookie, "DELETE", `/api/groups/${gid}/expenses/${creatorEid}`)).status)
      .toBe(200);
  });

  it("lets members settle only their own debts, while admins can settle for anyone", async () => {
    const seed = await api(
      creatorCookie,
      "POST",
      `/api/groups/${gid}/expenses`,
      expenseInput("settlement-debt"),
    );
    expect(seed.status).toBe(200);

    const ownDebt = await api(memberCookie, "POST", `/api/groups/${gid}/settlements`, {
      from: memberId,
      to: creatorId,
    });
    expect(ownDebt.status, JSON.stringify(ownDebt.json)).toBe(200);

    const anotherDebt = await api(
      creatorCookie,
      "POST",
      `/api/groups/${gid}/expenses`,
      expenseInput("admin-settlement-debt"),
    );
    expect(anotherDebt.status).toBe(200);
    const adminSettlement = await api(adminCookie, "POST", `/api/groups/${gid}/settlements`, {
      from: memberId,
      to: creatorId,
    });
    expect(adminSettlement.status).toBe(200);

    const forgedDebtor = await api(memberCookie, "POST", `/api/groups/${gid}/settlements`, {
      from: creatorId,
      to: memberId,
    });
    expect(forgedDebtor.status).toBe(403);
  });

  it("applies the same ownership rules to recurring expenses", async () => {
    const recurringInput = (title: string) => ({
      ...expenseInput(title),
      recurrence: "month",
      startDate: "2026-09-28",
    });
    const own = await api(
      memberCookie,
      "POST",
      `/api/groups/${gid}/recurring`,
      recurringInput("member recurring"),
    );
    expect(own.status).toBe(200);

    const theirs = await api(
      creatorCookie,
      "POST",
      `/api/groups/${gid}/recurring`,
      recurringInput("creator recurring"),
    );
    expect(theirs.status).toBe(200);
    const rid = String(theirs.json);
    expect((await api(memberCookie, "DELETE", `/api/groups/${gid}/recurring/${rid}`)).status)
      .toBe(404);
    expect((await api(adminCookie, "DELETE", `/api/groups/${gid}/recurring/${rid}`)).status)
      .toBe(200);
  });

  it("allows member self-leave but not removing other members", async () => {
    expect((await api(memberCookie, "DELETE", `/api/groups/${gid}/members/${candidateId}`)).status)
      .toBe(403);
    expect((await api(adminCookie, "DELETE", `/api/groups/${gid}/members/${creatorId}`)).status)
      .toBe(403);
    expect((await api(creatorCookie, "DELETE", `/api/groups/${gid}/members/${creatorId}`)).status)
      .toBe(400);
    expect((await api(memberCookie, "DELETE", `/api/groups/${gid}/members/${memberId}`)).status)
      .toBe(200);
  });

  it("transfers creator role atomically and reserves group deletion for the creator", async () => {
    const transfer = await api(
      creatorCookie,
      "PATCH",
      `/api/groups/${gid}/members/${candidateId}`,
      { role: "creator" },
    );
    expect(transfer.status).toBe(200);
    const transferredGroup = transfer.json as {
      createdBy: string;
      members: { userId: string; role: string }[];
    };
    expect(transferredGroup.createdBy).toBe(creatorId);
    expect(transferredGroup.members).toContainEqual({ userId: candidateId, role: "creator" });
    expect(transferredGroup.members).toContainEqual({ userId: creatorId, role: "admin" });

    expect((await api(creatorCookie, "DELETE", `/api/groups/${gid}`)).status).toBe(403);
    expect((await api(adminCookie, "DELETE", `/api/groups/${gid}`)).status).toBe(403);
    expect((await api(candidateCookie, "DELETE", `/api/groups/${gid}`)).status).toBe(200);
  });
});
