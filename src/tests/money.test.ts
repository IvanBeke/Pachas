import { describe, expect, it } from "vitest";
import { allocateMinor, fromCents, fromMills, round2, round3, toCents, toMills } from "../shared/money";

describe("toCents", () => {
  it("rounds half-cents the way a person would, despite float noise", () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(19.99)).toBe(1999);
  });

  it("round-trips through fromCents", () => {
    for (const cents of [0, 1, 99, 100, 123456789]) {
      expect(toCents(fromCents(cents))).toBe(cents);
    }
  });

  it("round2 is toCents then fromCents", () => {
    expect(round2(2.675)).toBe(2.68);
  });
});

describe("toMills", () => {
  it("rounds half-mills the way a person would, despite float noise", () => {
    expect(toMills(1.0005)).toBe(1001);
    expect(toMills(0.1 + 0.2)).toBe(300);
    expect(toMills(19.999)).toBe(19999);
    expect(toMills(9.213)).toBe(9213);
  });

  it("round-trips through fromMills", () => {
    for (const mills of [0, 1, 999, 1000, 123456789012]) {
      expect(toMills(fromMills(mills))).toBe(mills);
    }
  });

  it("round3 is toMills then fromMills, and finer than round2", () => {
    expect(round3(2.6755)).toBe(2.676);
    expect(round3(3.333)).toBe(3.333);
    expect(round2(3.333)).toBe(3.33);
  });

  it("is exactly ten times toCents for amounts typed with cents", () => {
    for (const amount of [0.01, 1, 12.34, 99.99, 1234567.89]) {
      expect(toMills(amount)).toBe(toCents(amount) * 10);
    }
  });
});

describe("allocateMinor", () => {
  it("always sums to the total", () => {
    for (const total of [1, 2, 10, 1000, 99999]) {
      for (const weights of [[1, 1, 1], [1, 2, 3], [0.3333, 0.3333, 0.3334], [7]]) {
        const parts = allocateMinor(total, weights);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        parts.forEach((p) => expect(Number.isInteger(p)).toBe(true));
      }
    }
  });

  it("splits in proportion to weights", () => {
    expect(allocateMinor(10000, [1, 3])).toEqual([2500, 7500]);
  });

  it("gives leftover cents to the earliest of equal remainders", () => {
    expect(allocateMinor(1000, [1, 1, 1])).toEqual([334, 333, 333]);
  });

  it("gives nothing to zero or negative weights", () => {
    expect(allocateMinor(100, [0, 1, -1])).toEqual([0, 100, 0]);
  });

  it("returns zeros when no weight is positive", () => {
    expect(allocateMinor(100, [0, 0])).toEqual([0, 0]);
  });

  it("handles negative totals symmetrically", () => {
    expect(allocateMinor(-1000, [1, 1, 1])).toEqual([-334, -333, -333]);
  });
});
