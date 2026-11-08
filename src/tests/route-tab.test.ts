import { describe, expect, it } from "vitest";
import { parseTab, tabQuery } from "../app/utils/route-tab";

const TABS = ["expenses", "balances", "activity"] as const;

describe("parseTab", () => {
  it("returns the listed tab", () => {
    for (const tab of TABS) expect(parseTab(tab, TABS)).toBe(tab);
  });

  it("falls back to the first tab for a missing, unknown or repeated value", () => {
    for (const value of [undefined, null, "", "Balances", "recurring", ["balances"], ["a", "b"], 1]) {
      expect(parseTab(value, TABS)).toBe("expenses");
    }
  });
});

describe("tabQuery", () => {
  it("sets the tab and keeps other params", () => {
    expect(tabQuery({ x: "1" }, "balances", "expenses")).toEqual({ x: "1", tab: "balances" });
  });

  it("replaces a previous tab", () => {
    expect(tabQuery({ tab: "activity" }, "balances", "expenses")).toEqual({ tab: "balances" });
  });

  it("removes the param for the default tab", () => {
    expect(tabQuery({ tab: "balances", x: "1" }, "expenses", "expenses")).toEqual({ x: "1" });
    expect(tabQuery({ tab: "balances" }, "expenses", "expenses")).toEqual({});
  });
});
