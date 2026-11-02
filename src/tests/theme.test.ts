import { describe, expect, it } from "vitest";
import { THEMES, isTheme, normalizeTheme } from "../shared/theme";

describe("theme", () => {
  it("accepts exactly the three supported values", () => {
    expect([...THEMES]).toEqual(["auto", "light", "dark"]);
    for (const theme of THEMES) expect(isTheme(theme)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of ["", "Dark", "blue", 1, null, undefined, {}]) {
      expect(isTheme(value)).toBe(false);
    }
  });

  it("falls back to auto for unknown stored values", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("sepia")).toBe("auto");
    expect(normalizeTheme(undefined)).toBe("auto");
  });
});
