import { describe, expect, it } from "vitest";
import { readRecurringDates } from "../server/utils/recurring-input";

describe("readRecurringDates", () => {
  it("requires a valid start date", () => {
    for (const startDate of [undefined, null, "", "2026-02-30", "2026-2-03"]) {
      expect(() => readRecurringDates(startDate, null)).toThrow();
    }
  });

  it("allows an absent or empty end date", () => {
    expect(readRecurringDates("2026-02-28", undefined)).toEqual({
      startDate: "2026-02-28",
      endDate: null,
    });
    expect(readRecurringDates("2026-02-28", "")).toEqual({
      startDate: "2026-02-28",
      endDate: null,
    });
  });

  it("accepts an inclusive end date on or after the start date", () => {
    expect(readRecurringDates("2026-02-28", "2026-02-28")).toEqual({
      startDate: "2026-02-28",
      endDate: "2026-02-28",
    });
    expect(readRecurringDates("2026-02-28", "2026-03-01").endDate).toBe(
      "2026-03-01",
    );
  });

  it("rejects invalid or earlier end dates", () => {
    for (const endDate of ["2026-02-30", "2026-2-28", 123]) {
      expect(() => readRecurringDates("2026-02-28", endDate)).toThrow();
    }
    expect(() => readRecurringDates("2026-02-28", "2026-02-27")).toThrow();
  });
});
