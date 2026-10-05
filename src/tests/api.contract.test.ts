import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSplits, round2, splitsToInputValues, type SplitType } from "../app/utils/splits";

const BASE = process.env.PACHAS_API ?? "http://localhost:3000";
const GROUP_NAME = "__contract__";

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
    me: (await res.json()) as { id: string; locale: string },
  };
}

/**
 * Every account this suite registers starts with `__t`, which
 * `scripts/cleanup-test-data.mjs` matches exactly. Keep it that way.
 */
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
    const creator = await register(`__to${RUN}splitcreator`, "split-pass-123");
    const member = await register(`__th${RUN}splitmember`, "split-pass-456");
    cookie = creator.cookie;
    memberA = creator.me.id;
    memberB = member.me.id;

    const created = await api(cookie, "POST", "/api/groups", {
      name: GROUP_NAME,
      baseCurrency: "EUR",
      memberIds: [memberA, memberB],
    });
    gid = String(created.json.id);
  });

  afterAll(async () => {
    if (!cookie || !gid) return;
    for (const e of (await listExpenses())) {
      await api(cookie, "DELETE", `/api/groups/${gid}/expenses/${e.id}`);
    }
  });

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

    const row = await byTitle("percent preview");
    expect(row?.splits).toEqual(preview.ok ? preview.splits : {});
  });

  it("percent edit pre-fill reconstructs valid percentages", async () => {
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
    const a = await register(`__to${RUN}`, "owner-pass-1");
    ownerCookie = a.cookie;
    ownerId = a.me.id;
    const b = await register(`__th${RUN}`, "other-pass-1");
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
    expect(r.status).toBe(404);
    expect((await listExpenses(ownerCookie)).some((e) => e.id === id)).toBe(true);
    await api(ownerCookie, "DELETE", `/api/groups/${gid}/expenses/${id}`);
  });

  it("stops a non-member deleting an expense", async () => {
    const id = await createOwned("outsider");
    const stranger = await register(`__ts${RUN}`, "stranger-pass-1");
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
    const session = await register(`__to${RUN}sess`, "sess-pass-123");
    const token = session.cookie.split("=")[1] ?? "";
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const me = await api(session.cookie, "GET", "/api/me");
    expect(me.status).toBe(200);

    const forged = await api(
      `pachas.sid=${token.slice(0, 63)}${token.endsWith("f") ? "0" : "f"}`,
      "GET",
      "/api/me",
    );
    expect(forged.status).toBe(401);

    const out = await api(session.cookie, "POST", "/api/logout");
    expect(out.status).toBe(200);

    const replay = await api(session.cookie, "GET", "/api/me");
    expect(replay.status).toBe(401);
  });

  it("treats a malformed percent-encoded cookie as absent, not a crash", async () => {
    for (const bad of ["%", "%zz", "abc%"]) {
      const r = await api(`pachas.sid=${bad}`, "GET", "/api/me");
      expect(r.status, `cookie value ${JSON.stringify(bad)}`).toBe(401);
    }
  });

  it("rate limits repeated failed logins", async () => {
    const username = `__to${RUN}brute`;
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
    const username = `__to${RUN}ok`;
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
    expect(res.headers.get("x-powered-by")).toBeFalsy();
  });

  it("rejects a poisoned amount instead of writing NaN to the ledger", async () => {
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

  it("lets the creator add members but not plain members", async () => {
    const outsider = await register(`__th${RUN}add`, "add-pass-123");

    const created = await api(ownerCookie, "POST", "/api/groups", {
      name: `${GROUP_NAME}add`,
      baseCurrency: "EUR",
      memberIds: [ownerId, otherId],
    });
    const addGid = String(created.json.id);

    const asMember = await api(
      otherCookie,
      "POST",
      `/api/groups/${addGid}/members`,
      { userId: outsider.me.id },
    );
    expect(asMember.status).toBe(403);

    const asCreator = await api(
      ownerCookie,
      "POST",
      `/api/groups/${addGid}/members`,
      { userId: outsider.me.id },
    );
    expect(asCreator.status).toBe(200);
    expect((asCreator.json as { members: { userId: string; role: string }[] }).members)
      .toContainEqual({ userId: outsider.me.id, role: "member" });
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

    const self = await api(
      otherCookie,
      "DELETE",
      `/api/groups/${leaveGid}/members/${otherId}`,
    );
    expect(self.status).toBe(200);

    const creatorOut = await api(
      ownerCookie,
      "DELETE",
      `/api/groups/${leaveGid}/members/${ownerId}`,
    );
    expect(creatorOut.status).toBe(400);
  });

  it("freezes the base currency once the group has expenses", async () => {
    const created = await api(ownerCookie, "POST", "/api/groups", {
      name: `${GROUP_NAME}ccy`,
      baseCurrency: "EUR",
      memberIds: [ownerId, otherId],
    });
    const ccyGid = String(created.json.id);

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
    for (const q of ["%25%25", "__", "_%"]) {
      const r = await api(ownerCookie, "GET", `/api/users/search?q=${q}`);
      expect(r.status, `q=${q}`).toBe(200);
      expect(
        Array.isArray(r.json) ? r.json.length : -1,
        `wildcard q=${q} must match nobody`,
      ).toBe(0);
    }

    const short = await api(ownerCookie, "GET", "/api/users/search?q=a");
    expect(Array.isArray(short.json) ? short.json.length : 0).toBe(0);

    const real = await api(ownerCookie, "GET", "/api/users/search?q=oth");
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
    expect([403, 404]).toContain(r.status);
    expect((await listExpenses(ownerCookie)).some((e) => e.id === id)).toBe(true);
    await api(ownerCookie, "DELETE", `/api/groups/${gid}/expenses/${id}`);
  });
});

describe.skipIf(!reachable)("user profile contract", () => {
  it("updates name and language, keeps username immutable, and changes password", async () => {
    const session = await register(`__tp${RUN}`, "profile-pass-123");
    const initial = await api(session.cookie, "GET", "/api/me");
    expect(initial.status).toBe(200);
    expect(initial.json.locale).toBe("es");

    const renameUsername = await api(session.cookie, "PATCH", "/api/me", {
      username: `renamed${RUN}`,
      name: "Should not be applied",
    });
    expect(renameUsername.status).toBe(400);

    const wrongCurrentPassword = await api(session.cookie, "PATCH", "/api/me", {
      currentPassword: "incorrect-current",
      newPassword: "profile-pass-456",
    });
    expect(wrongCurrentPassword.status).toBe(400);

    const update = await api(session.cookie, "PATCH", "/api/me", {
      name: "Updated Profile",
      locale: "en",
      currentPassword: "profile-pass-123",
      newPassword: "profile-pass-456",
    });
    expect(update.status).toBe(200);
    expect(update.json).toMatchObject({
      username: `__tp${RUN}`,
      name: "Updated Profile",
      locale: "en",
    });

    const oldPasswordLogin = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: `__tp${RUN}`, password: "profile-pass-123" }),
    });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await login(`__tp${RUN}`, "profile-pass-456");
    expect(newPasswordLogin.me.id).toBe(session.me.id);
    expect(newPasswordLogin.me.locale).toBe("en");
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
    const creator = await register(`__to${RUN}rolecreator`, "creator-pass-1");
    const member = await register(`__th${RUN}rolemember`, "member-pass-1");
    const admin = await register(`__to${RUN}roleadmin`, "admin-pass-1");
    const candidate = await register(`__th${RUN}rolecandidate`, "candidate-pass-1");
    const outsider = await register(`__to${RUN}roleoutsider`, "outsider-pass-1");
    const unaffiliated = await register(`__th${RUN}roleunaffiliated`, "unaffiliated-pass-1");
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

  const expenseInput = (
    title: string,
    paidBy = creatorId,
    participants = [creatorId, memberId],
  ) => ({
    title,
    amount: 20,
    amountBase: 20,
    currency: "EUR",
    exchangeRate: 1,
    paidBy,
    category: "1",
    date: "2026-09-28",
    splitType: "equal",
    participants,
  });

  async function createChainGroup(name: string, simplifyTransfers: boolean) {
    const created = await api(creatorCookie, "POST", "/api/groups", {
      name: `${name}${RUN}`,
      baseCurrency: "EUR",
      memberIds: [adminId, memberId],
    });
    expect(created.status).toBe(200);
    const chainGid = String(created.json.id);
    const settings = await api(creatorCookie, "PATCH", `/api/groups/${chainGid}`, {
      name: `${name}${RUN}`,
      simplifyTransfers,
    });
    expect(settings.status).toBe(200);
    const first = await api(
      creatorCookie,
      "POST",
      `/api/groups/${chainGid}/expenses`,
      expenseInput("A pays for B", creatorId, [creatorId, adminId]),
    );
    expect(first.status).toBe(200);
    const second = await api(
      adminCookie,
      "POST",
      `/api/groups/${chainGid}/expenses`,
      expenseInput("B pays for C", adminId, [adminId, memberId]),
    );
    expect(second.status).toBe(200);
    return chainGid;
  }

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

  it("lets group admins add members, always with the member role", async () => {
    const asMember = await api(
      memberCookie,
      "POST",
      `/api/groups/${gid}/members`,
      { userId: outsiderId },
    );
    expect(asMember.status).toBe(403);
    const added = await api(
      adminCookie,
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
    const recurringInput = (title: string, endDate?: string) => ({
      ...expenseInput(title),
      recurrence: "month",
      // In the future, so no occurrence is generated and balances stay clean.
      startDate: "2099-01-01",
      ...(endDate ? { endDate } : {}),
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
      recurringInput("creator recurring", "2099-12-31"),
    );
    expect(theirs.status).toBe(200);
    const rid = String(theirs.json);
    const listed = await api(memberCookie, "GET", `/api/groups/${gid}/recurring`);
    const recurringRows = listed.json as { id: string; endDate: string | null }[];
    expect(recurringRows.find((row) => row.id === rid)?.endDate).toBe("2099-12-31");
    const ownRid = String(own.json);
    expect(recurringRows.find((row) => row.id === ownRid)?.endDate).toBeNull();
    expect((await api(memberCookie, "DELETE", `/api/groups/${gid}/recurring/${rid}`)).status)
      .toBe(404);
    expect((await api(adminCookie, "DELETE", `/api/groups/${gid}/recurring/${rid}`)).status)
      .toBe(200);
  });

  it("validates recurring split selections and computes saved shares on the server", async () => {
    const input = {
      ...expenseInput("recurring split contract"),
      recurrence: "month",
      // In the future, so no occurrence is generated and balances stay clean.
      startDate: "2099-01-01",
      splitType: "exact",
      values: { [creatorId]: 13, [memberId]: 7 },
      // A forged final split map is ignored; the server uses the selections.
      splits: { [creatorId]: 1, [memberId]: 19 },
    };

    const invalid = await api(creatorCookie, "POST", `/api/groups/${gid}/recurring`, {
      ...input,
      values: { [creatorId]: 10, [memberId]: 5 },
    });
    expect(invalid.status).toBe(400);

    const created = await api(
      creatorCookie,
      "POST",
      `/api/groups/${gid}/recurring`,
      input,
    );
    expect(created.status).toBe(200);
    const recurringId = String(created.json);
    const listed = await api(creatorCookie, "GET", `/api/groups/${gid}/recurring`);
    const saved = (
      listed.json as { id: string; splits: Record<string, number> }[]
    ).find((row) => row.id === recurringId);
    expect(saved?.splits).toEqual({ [creatorId]: 13, [memberId]: 7 });
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

  it("lets a net-zero intermediary leave in simplified mode, then allocates C-to-A across the chain", async () => {
    const chainGid = await createChainGroup("__net_chain__", true);
    const plan = await api(creatorCookie, "GET", `/api/groups/${chainGid}/settlements/plan`);
    expect(plan.json.transfers).toEqual([
      { from: memberId, to: creatorId, amount: 10 },
    ]);

    const leave = await api(adminCookie, "DELETE", `/api/groups/${chainGid}/members/${adminId}`);
    expect(leave.status).toBe(200);
    const blockedModeSwitch = await api(
      creatorCookie,
      "PATCH",
      `/api/groups/${chainGid}`,
      { name: `__net_chain__${RUN}`, simplifyTransfers: false },
    );
    expect(blockedModeSwitch.status).toBe(409);
    expect(blockedModeSwitch.json.message).toBe("pairwise_plan_includes_former_members");

    const payment = await api(
      memberCookie,
      "POST",
      `/api/groups/${chainGid}/settlements`,
      { from: memberId, to: creatorId },
    );
    expect(payment.status, JSON.stringify(payment.json)).toBe(200);
    const settledPlan = await api(
      creatorCookie,
      "GET",
      `/api/groups/${chainGid}/settlements/plan`,
    );
    expect(settledPlan.json.transfers).toEqual([]);
    expect(settledPlan.json.balances).toEqual(
      expect.arrayContaining([
        { memberId: creatorId, amount: 0 },
        { memberId: adminId, amount: 0 },
        { memberId: memberId, amount: 0 },
      ]),
    );
    const deletePayment = await api(
      memberCookie,
      "DELETE",
      `/api/groups/${chainGid}/settlements/${String(payment.json.id)}`,
    );
    expect(deletePayment.status).toBe(200);
    const restoredPlan = await api(
      creatorCookie,
      "GET",
      `/api/groups/${chainGid}/settlements/plan`,
    );
    expect(restoredPlan.json.transfers).toEqual([
      { from: memberId, to: creatorId, amount: 10 },
    ]);
    await api(creatorCookie, "DELETE", `/api/groups/${chainGid}`);
  });

  it("blocks leave and removal when pairwise suggestions involve the member", async () => {
    const chainGid = await createChainGroup("__pair_chain__", false);
    const plan = await api(creatorCookie, "GET", `/api/groups/${chainGid}/settlements/plan`);
    expect(plan.json.transfers).toHaveLength(2);
    expect(plan.json.transfers).toEqual(
      expect.arrayContaining([
        { from: adminId, to: creatorId, amount: 10 },
        { from: memberId, to: adminId, amount: 10 },
      ]),
    );

    const selfLeave = await api(
      adminCookie,
      "DELETE",
      `/api/groups/${chainGid}/members/${adminId}`,
    );
    expect(selfLeave.status).toBe(409);
    expect(selfLeave.json.message).toBe("member_has_outstanding_payments");
    const adminRemoval = await api(
      creatorCookie,
      "DELETE",
      `/api/groups/${chainGid}/members/${adminId}`,
    );
    expect(adminRemoval.status).toBe(409);
    expect(adminRemoval.json.message).toBe("member_has_outstanding_payments");
    await api(creatorCookie, "DELETE", `/api/groups/${chainGid}`);
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

describe.skipIf(!reachable)("request guard", () => {
  it("rejects cross-site writes", async () => {
    const res = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
      body: JSON.stringify({ username: "x", password: "y" }),
    });
    expect(res.status).toBe(403);
    const fromOrigin = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body: JSON.stringify({ username: "x", password: "y" }),
    });
    expect(fromOrigin.status).toBe(403);
  });

  it("rejects form-encoded writes", async () => {
    const res = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "username=x&password=y",
    });
    expect(res.status).toBe(415);
  });

  it("rejects oversized JSON bodies", async () => {
    const res = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "x", password: "y".repeat(70_000) }),
    });
    expect(res.status).toBe(413);
  });

  it("does not expose whether users exist", async () => {
    const res = await fetch(`${BASE}/api/config`);
    expect(await res.json()).not.toHaveProperty("hasUsers");
  });
});

describe.skipIf(!reachable)("session lifecycle", () => {
  it("signs out other sessions when the password changes", async () => {
    const name = `__to${RUN}sessrevoke`;
    const first = await register(name, "first-pass-123");
    const second = await login(name, "first-pass-123");
    const changed = await fetch(`${BASE}/api/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: first.cookie },
      body: JSON.stringify({
        currentPassword: "first-pass-123",
        newPassword: "second-pass-123",
      }),
    });
    expect(changed.status).toBe(200);
    const rotated =
      changed.headers
        .getSetCookie()
        .map((c) => c.split(";")[0] ?? "")
        .find((c) => !c.endsWith("=")) ?? "";
    expect(rotated).not.toBe(first.cookie);
    expect((await api(second.cookie, "GET", "/api/me")).status).toBe(401);
    expect((await api(first.cookie, "GET", "/api/me")).status).toBe(401);
    expect((await api(rotated, "GET", "/api/me")).status).toBe(200);
  });

  it("does not leak the site role of other users", async () => {
    const a = await register(`__to${RUN}rolevis`, "role-pass-123");
    const res = await api(a.cookie, "GET", `/api/users?ids=${a.me.id}`);
    expect((res.json as unknown as Record<string, unknown>[])[0]).not.toHaveProperty("role");
  });
});

describe.skipIf(!reachable)("recurring expense generation", () => {
  it("creates due occurrences once, linked to the template", async () => {
    const owner = await register(`__to${RUN}recgen`, "recgen-pass-123");
    const other = await register(`__th${RUN}recgen`, "recgen-pass-456");
    const group = await api(owner.cookie, "POST", "/api/groups", {
      name: `${GROUP_NAME}recgen`,
      baseCurrency: "EUR",
      memberIds: [other.me.id],
    });
    const gid = String(group.json.id);
    // Weekly, starting 15 days ago: three occurrences are due (0, 7, 14 days).
    const start = new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10);
    const created = await api(owner.cookie, "POST", `/api/groups/${gid}/recurring`, {
      title: "Cleaning",
      amount: 30,
      currency: "EUR",
      paidBy: owner.me.id,
      splitType: "equal",
      participants: [owner.me.id, other.me.id],
      recurrence: "week",
      startDate: start,
    });
    expect(created.status).toBe(200);
    const rid = String(created.json);

    const list = async () =>
      (await api(owner.cookie, "GET", `/api/groups/${gid}/expenses`)).json as unknown as {
        recurringId: string | null;
        amountBase: number;
        splits: Record<string, number>;
      }[];
    const first = await list();
    expect(first).toHaveLength(3);
    for (const e of first) {
      expect(e.recurringId).toBe(rid);
      expect(e.splits).toEqual({ [owner.me.id]: 15, [other.me.id]: 15 });
    }

    // Editing the template must not re-create past occurrences.
    const edited = await api(owner.cookie, "PATCH", `/api/groups/${gid}/recurring/${rid}`, {
      title: "Cleaning (edited)",
      amount: 40,
      currency: "EUR",
      paidBy: owner.me.id,
      splitType: "equal",
      participants: [owner.me.id, other.me.id],
      recurrence: "week",
      startDate: start,
    });
    expect(edited.status).toBe(200);
    expect(await list()).toHaveLength(3);

    const plan = await api(owner.cookie, "GET", `/api/groups/${gid}/settlements/plan`);
    expect((plan.json as { transfers: unknown[] }).transfers).toEqual([
      { from: other.me.id, to: owner.me.id, amount: 45 },
    ]);
  });
});

describe.skipIf(!reachable)("group summary", () => {
  it("answers 304 until the group changes", async () => {
    const owner = await register(`__to${RUN}summary`, "summary-pass-123");
    const group = await api(owner.cookie, "POST", "/api/groups", {
      name: `${GROUP_NAME}summary`,
      baseCurrency: "EUR",
      memberIds: [],
    });
    const gid = String(group.json.id);
    const get = (etag?: string) =>
      fetch(`${BASE}/api/groups/${gid}/summary`, {
        headers: { cookie: owner.cookie, ...(etag ? { "if-none-match": etag } : {}) },
      });
    const first = await get();
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag") ?? "";
    expect(etag).not.toBe("");
    expect((await get(etag)).status).toBe(304);

    await api(owner.cookie, "POST", `/api/groups/${gid}/expenses`, {
      title: "Coffee",
      amount: 3,
      paidBy: owner.me.id,
      participants: [owner.me.id],
    });
    const changed = await get(etag);
    expect(changed.status).toBe(200);
    const body = (await changed.json()) as { expenses: { amountBase: number }[] };
    expect(body.expenses).toEqual([expect.objectContaining({ amountBase: 3 })]);
  });
});
