import { describe, expect, it } from "vitest";
import { allocateCents, fromCents, round2, toCents } from "../shared/money";

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

describe("allocateCents", () => {
  it("always sums to the total", () => {
    for (const total of [1, 2, 10, 1000, 99999]) {
      for (const weights of [[1, 1, 1], [1, 2, 3], [0.3333, 0.3333, 0.3334], [7]]) {
        const parts = allocateCents(total, weights);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        parts.forEach((p) => expect(Number.isInteger(p)).toBe(true));
      }
    }
  });

  it("splits in proportion to weights", () => {
    expect(allocateCents(10000, [1, 3])).toEqual([2500, 7500]);
  });

  it("gives leftover cents to the earliest of equal remainders", () => {
    expect(allocateCents(1000, [1, 1, 1])).toEqual([334, 333, 333]);
  });

  it("gives nothing to zero or negative weights", () => {
    expect(allocateCents(100, [0, 1, -1])).toEqual([0, 100, 0]);
  });

  it("returns zeros when no weight is positive", () => {
    expect(allocateCents(100, [0, 0])).toEqual([0, 0]);
  });

  it("handles negative totals symmetrically", () => {
    expect(allocateCents(-1000, [1, 1, 1])).toEqual([-334, -333, -333]);
  });
});
