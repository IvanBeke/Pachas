import { describe, expect, it } from "vitest";
import { allocateRoundRobin, toCents } from "../shared/money";
import { computeSplits, roundingRing, sumSplits } from "../shared/splits";

const IDS = ["a", "b", "c", "d", "e"];
const ring = (n: number, cursor = 0) => ({ order: IDS.slice(0, n), cursor });

describe("allocateRoundRobin", () => {
  it("gives the leftover cent of 10.00 ÷ 3 to the cursor and moves it on", () => {
    const ids = ["a", "b", "c"];
    let cursor = 0;
    const holders: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = allocateRoundRobin(1000, [1, 1, 1], ids, { order: ids, cursor });
      expect(r.cents.reduce((x, y) => x + y, 0)).toBe(1000);
      holders.push(ids[r.cents.indexOf(334)]!);
      cursor = r.nextCursor;
    }
    expect(holders).toEqual(["a", "b", "c", "a", "b", "c"]);
  });

  it("rotates a half cent between two people", () => {
    const ids = ["a", "b"];
    const first = allocateRoundRobin(1001, [1, 1], ids, { order: ids, cursor: 0 });
    expect(first.cents).toEqual([501, 500]);
    const second = allocateRoundRobin(1001, [1, 1], ids, { order: ids, cursor: first.nextCursor });
    expect(second.cents).toEqual([500, 501]);
  });

  it("rounds the clear cases the obvious way (x.867 up, x.893 down)", () => {
    // Ideal shares 8.867 / 8.893 / 16.340 of 34.10.
    const r = allocateRoundRobin(3410, [8867, 8893, 16_340], ["a", "b", "c"], ring(3));
    expect(r.cents).toEqual([887, 889, 1634]);
    // Remainders differ, so no tie was broken and the cursor stays.
    expect(r.nextCursor).toBe(0);
  });

  it("keeps whole-cent weights exact and does not move the cursor", () => {
    const r = allocateRoundRobin(1000, [333, 333, 334], ["a", "b", "c"], ring(3, 2));
    expect(r.cents).toEqual([333, 333, 334]);
    expect(r.nextCursor).toBe(2);
  });

  it("n equal splits of one cent give every one of n people exactly one", () => {
    for (let n = 2; n <= 5; n++) {
      const ids = IDS.slice(0, n);
      const got = ids.map(() => 0);
      let cursor = 0;
      for (let i = 0; i < n; i++) {
        const r = allocateRoundRobin(1, ids.map(() => 1), ids, { order: ids, cursor });
        r.cents.forEach((m, k) => (got[k] = got[k]! + m));
        cursor = r.nextCursor;
      }
      expect(got).toEqual(ids.map(() => 1));
    }
  });

  it("starts from the cursor's turn even when it is not a participant", () => {
    // b and c take part; the cursor points at a, so b is the closest after it.
    const odd = allocateRoundRobin(1, [1, 1], ["b", "c"], ring(3, 0));
    expect(odd.cents).toEqual([1, 0]);
    expect(odd.nextCursor).toBe(2);
  });

  it("holds the invariants for generated totals, weights and cursors", () => {
    for (let i = 1; i <= 400; i++) {
      const n = (i % 5) + 1;
      const ids = IDS.slice(0, n);
      const total = ((i * 7919) % 99_983) + 1;
      const weights = ids.map((_, k) => (((i + k) * 104_729) % 1000) + (k % 2 === 0 ? 1 : 0));
      const cursor = i % 7;
      const r = allocateRoundRobin(total, weights, ids, { order: IDS, cursor });
      const wSum = weights.reduce((x, w) => x + w, 0);
      if (!(wSum > 0)) continue;
      expect(r.cents.reduce((x, y) => x + y, 0), `sum ${i}`).toBe(total);
      r.cents.forEach((m, k) => {
        expect(Number.isInteger(m)).toBe(true);
        const ideal = (total * weights[k]!) / wSum;
        expect(Math.abs(m - ideal), `close ${i}/${k}`).toBeLessThan(1 + 1e-6);
      });
      expect(r.nextCursor).toBeGreaterThanOrEqual(0);
      expect(r.nextCursor).toBeLessThan(IDS.length);
    }
  });

  it("equal weights never differ by more than one cent", () => {
    for (let total = 1; total <= 300; total++) {
      for (let n = 2; n <= 5; n++) {
        const ids = IDS.slice(0, n);
        const r = allocateRoundRobin(total, ids.map(() => 1), ids, ring(n, total % n));
        expect(Math.max(...r.cents) - Math.min(...r.cents)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("computeSplits with a ring", () => {
  const members = ["a", "b", "c"];

  it("shares 10.00 in cents and returns the next cursor", () => {
    const r = computeSplits({
      splitType: "equal",
      amountBase: 10,
      participants: members,
      memberIds: members,
      values: {},
      rounding: roundingRing(members, 1),
    });
    expect(r).toEqual({ ok: true, splits: { a: 3.33, b: 3.34, c: 3.33 }, nextCursor: 2 });
  });

  it("splits 33.33 / 33.33 / 33.34 % of 10 into cents", () => {
    const r = computeSplits({
      splitType: "percent",
      amountBase: 10,
      participants: members,
      memberIds: members,
      values: { a: 33.33, b: 33.33, c: 33.34 },
      rounding: roundingRing(members, 0),
    });
    expect(r.ok && r.splits).toEqual({ a: 3.33, b: 3.33, c: 3.34 });
  });

  it("every split type sums to the total", () => {
    for (const splitType of ["equal", "percent", "shares", "exact", "items"] as const) {
      const r = computeSplits({
        splitType,
        amountBase: 77.77,
        amount: 77.77,
        participants: members,
        memberIds: members,
        values:
          splitType === "percent"
            ? { a: 33.33, b: 33.33, c: 33.34 }
            : splitType === "exact"
              ? { a: 30, b: 30, c: 17.77 }
              : { a: 1, b: 2, c: 4 },
        items: [{ name: "x", price: 77.77, members: ["a", "b", "c"] }],
        rounding: roundingRing(members, 2),
      });
      expect(r.ok, splitType).toBe(true);
      if (!r.ok) continue;
      expect(toCents(sumSplits(r.splits)), splitType).toBe(7777);
    }
  });

  it("orders the ring by member id, whatever order the group lists them in", () => {
    expect(roundingRing(["c", "a", "b"], 1)).toEqual({ order: ["a", "b", "c"], cursor: 1 });
  });
});
