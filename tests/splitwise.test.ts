import { describe, expect, it } from "vitest";
import { analyzeSplitwiseCsv, parseCsvLine } from "../server/utils/splitwise";

/** Build a CSV with the given member columns and body lines. */
function csv(members: string[], rows: string[][]): string {
  const header = ["Fecha", "Descripción", "Categoría", "Coste", "Moneda", ...members];
  const lines = [header.join(",")];
  for (const r of rows) lines.push(r.join(","));
  return lines.join("\n");
}

const A = "beke";
const B = "test";

describe("parseCsvLine", () => {
  it("splits plain columns", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsvLine('Ramen, "sopa, caldo", 3')).toEqual([
      "Ramen",
      "sopa, caldo",
      "3",
    ]);
  });

  it("trims surrounding whitespace", () => {
    expect(parseCsvLine(" a , b ")).toEqual(["a", "b"]);
  });
});

describe("analyzeSplitwiseCsv", () => {
  it("rejects a file with no data rows", () => {
    expect(() => analyzeSplitwiseCsv(csv([A, B], []), 2)).toThrowError();
  });

  it("rejects a wrong header and names the column", () => {
    try {
      analyzeSplitwiseCsv(
        "Fecha,Wrong,Categoría,Coste,Moneda,a,b\n2026-01-01,x,G,1,EUR,-0.5,0.5",
        2,
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as { message?: string; data?: Record<string, unknown> };
      expect(err.message).toBe("bad_header");
      expect(err.data).toMatchObject({ col: 2, expected: "Descripción" });
    }
  });

  it("rejects a member-count mismatch and reports both counts", () => {
    try {
      analyzeSplitwiseCsv(csv([A, B, "extra"], [["2026-01-01", "x", "G", "1.00", "EUR"]]), 2);
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as { message?: string; data?: Record<string, unknown> };
      expect(err.message).toBe("member_count");
      expect(err.data).toEqual({ csv: 3, group: 2 });
    }
  });

  it("derives the payer's own share, not just the debtors'", () => {
    // The reported bug: 10.20 split two ways is 5.10 each, including the payer.
    const out = analyzeSplitwiseCsv(
      csv([A, B], [["2026-09-26", "Infusiones", "General", "10.20", "EUR", "-5.10", "5.10"]]),
      2,
    );
    expect(out.total).toBe(1);
    expect(out.rows[0]?.splits).toEqual({ [A]: 5.1, [B]: 5.1 });
    expect(out.rows[0]?.paidBy).toBe(B);
  });

  it("never produces a non-finite share", () => {
    // Regression guard: `undefined + n` used to leak NaN, which JSON.stringify
    // wrote as null and the server rejected as "splits do not add up".
    const cases: string[][] = [
      ["2026-01-01", "x", "G", "4.10", "EUR", "-2.05", "2.05"],
      ["2026-01-02", "y", "G", "10.00", "EUR", "0.00", "10.00"],
      ["2026-01-03", "z", "G", "30.00", "EUR", "-10.00", "10.00", "10.00"],
    ];
    const out = analyzeSplitwiseCsv(csv([A, B, "third"], cases), 3);
    for (const row of out.rows) {
      for (const v of Object.values(row.splits)) expect(Number.isFinite(v)).toBe(true);
      const sum = Object.values(row.splits).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(row.amount, 2);
    }
  });

  it("omits the payer when they fronted the entire bill", () => {
    const out = analyzeSplitwiseCsv(
      csv([A, B], [["2026-01-01", "rent", "Hogar", "100.00", "EUR", "-100.00", "100.00"]]),
      2,
    );
    expect(out.rows[0]?.splits).toEqual({ [A]: 100 });
  });

  it("skips rows where nobody owes anything", () => {
    const out = analyzeSplitwiseCsv(
      csv([A, B], [
        ["2026-01-01", "ok", "G", "10.00", "EUR", "-5.00", "5.00"],
        ["2026-01-02", "no debt", "G", "10.00", "EUR", "0.00", "10.00"],
      ]),
      2,
    );
    expect(out.total).toBe(1);
    expect(out.skipped).toBe(1);
  });

  it("ignores rows without a cost and blank lines", () => {
    const out = analyzeSplitwiseCsv(
      [
        "Fecha,Descripción,Categoría,Coste,Moneda,beke,test",
        "2026-01-01,a,General,10.00,EUR,-5.00,5.00",
        "",
        "2026-01-02,b,General,,EUR,,",
        "   ",
      ].join("\n"),
      2,
    );
    expect(out.total).toBe(1);
  });

  it("collects the distinct categories for the matching step", () => {
    const out = analyzeSplitwiseCsv(
      csv([A, B], [
        ["2026-01-01", "a", "Comida", "10.00", "EUR", "-5.00", "5.00"],
        ["2026-01-02", "b", "Comida", "10.00", "EUR", "-5.00", "5.00"],
        ["2026-01-03", "c", "Ocio", "10.00", "EUR", "-5.00", "5.00"],
      ]),
      2,
    );
    expect(out.categories.sort()).toEqual(["Comida", "Ocio"]);
  });

  it("totals the importable rows", () => {
    const out = analyzeSplitwiseCsv(
      csv([A, B], [
        ["2026-01-01", "a", "G", "10.20", "EUR", "-5.10", "5.10"],
        ["2026-01-02", "b", "G", "30.00", "EUR", "-15.00", "15.00"],
      ]),
      2,
    );
    expect(out.total).toBe(2);
    expect(out.totalAmount).toBe(40.2);
  });

  it("reconciles penny-rounding rows back to the cost", () => {
    const out = analyzeSplitwiseCsv(
      csv(["a", "b", "c"], [["2026-01-01", "x", "G", "10.00", "EUR", "-3.33", "-3.33", "6.66"]]),
      3,
    );
    const row = out.rows[0];
    if (!row) throw new Error("expected a parsed row");
    const sum = Object.values(row.splits).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(10, 2);
  });

  it("rejects a row with a malformed date", () => {
    const out = analyzeSplitwiseCsv(
      csv([A, B], [["not-a-date", "x", "G", "10.00", "EUR", "-5.00", "5.00"]]),
      2,
    );
    expect(out.total).toBe(0);
    expect(out.skipped).toBe(1);
  });
});
