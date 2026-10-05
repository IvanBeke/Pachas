import { describe, expect, it } from "vitest";
import { dueOccurrences, occurrenceDate } from "../server/utils/recurring-schedule";

describe("occurrenceDate", () => {
  it("steps weekly", () => {
    expect(occurrenceDate("2026-01-01", "week", 0)).toBe("2026-01-01");
    expect(occurrenceDate("2026-01-01", "week", 2)).toBe("2026-01-15");
  });

  it("keeps the day of month and clamps to short months", () => {
    expect(occurrenceDate("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(occurrenceDate("2026-01-31", "month", 2)).toBe("2026-03-31");
    expect(occurrenceDate("2028-01-31", "month", 1)).toBe("2028-02-29");
  });

  it("crosses year boundaries", () => {
    expect(occurrenceDate("2026-11-15", "month", 3)).toBe("2027-02-15");
  });

  it("handles leap days yearly", () => {
    expect(occurrenceDate("2028-02-29", "year", 1)).toBe("2029-02-28");
    expect(occurrenceDate("2028-02-29", "year", 4)).toBe("2032-02-29");
  });
});

describe("dueOccurrences", () => {
  const monthly = {
    startDate: "2026-01-10",
    endDate: null,
    recurrence: "month" as const,
    generatedThrough: null,
  };

  it("catches up from the start date when nothing was generated", () => {
    expect(dueOccurrences(monthly, "2026-03-10")).toEqual([
      "2026-01-10",
      "2026-02-10",
      "2026-03-10",
    ]);
  });

  it("only returns occurrences after generated_through", () => {
    expect(
      dueOccurrences({ ...monthly, generatedThrough: "2026-02-10" }, "2026-04-01"),
    ).toEqual(["2026-03-10"]);
  });

  it("stops at the end date", () => {
    expect(dueOccurrences({ ...monthly, endDate: "2026-02-15" }, "2026-12-31")).toEqual([
      "2026-01-10",
      "2026-02-10",
    ]);
  });

  it("returns nothing before the start date", () => {
    expect(dueOccurrences(monthly, "2026-01-09")).toEqual([]);
  });

  it("is capped per run", () => {
    expect(
      dueOccurrences({ ...monthly, recurrence: "week" }, "2100-01-01", 5),
    ).toHaveLength(5);
  });
});
