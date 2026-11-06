import { describe, expect, it } from "vitest";
import { fmt, type ExpenseItem } from "../app/utils/format";
import { itemsTotals } from "../app/utils/splits";

describe("fmt", () => {
  it("renders a currency amount with two decimals", () => {
    expect(fmt(10.5, "EUR")).toMatch(/10[.,]50/);
  });

  it("marks negatives", () => {
    expect(fmt(-20.26, "EUR")).toContain("-");
  });

  it("falls back to the code for an unknown currency", () => {
    expect(fmt(5, "ZZZ")).toContain("ZZZ");
  });
});

describe("itemsTotals", () => {
  const items: ExpenseItem[] = [
    { name: "Ramen", price: 20, members: ["a", "b"] },
    { name: "Gyoza", price: 6, members: ["b"] },
  ];

  it("splits a shared item evenly between its members", () => {
    const t = itemsTotals(items, ["a", "b"]);
    expect(t.a).toBe(10);
    expect(t.b).toBe(16);
  });

  it("charges an item only to the members assigned to it", () => {
    const t = itemsTotals([{ name: "Sake", price: 10, members: ["a"] }], ["a", "b"]);
    expect(t.a).toBe(10);
    expect(t.b).toBe(0);
  });

  it("ignores members who are not in the group", () => {
    const t = itemsTotals([{ name: "X", price: 10, members: ["a", "ghost"] }], ["a"]);
    expect(t.a).toBe(10);
  });

  it("keeps an item's shares summing to its price despite rounding", () => {
    const t = itemsTotals([{ name: "Odd", price: 10, members: ["a", "b", "c"] }], ["a", "b", "c"]);
    const sum = Object.values(t).reduce((x, y) => x + y, 0);
    expect(sum).toBe(10);
  });

  it("returns zeros for an empty basket", () => {
    expect(itemsTotals([], ["a", "b"])).toEqual({ a: 0, b: 0 });
  });
});
