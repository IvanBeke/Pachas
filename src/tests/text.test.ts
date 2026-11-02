import { describe, expect, it } from "vitest";
import { normalizeText } from "../shared/text";

describe("normalizeText", () => {
  it("ignores case and accents", () => {
    expect(normalizeText("Mercadoná")).toBe("mercadona");
    expect(normalizeText("ÁÉÍÓÚ ñ ü")).toBe("aeiou n u");
  });

  it("collapses and trims whitespace", () => {
    expect(normalizeText("  Gas   natural \t")).toBe("gas natural");
  });

  it("treats precomposed and decomposed accents the same", () => {
    expect(normalizeText("caf\u00e9")).toBe(normalizeText("cafe\u0301"));
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeText("   ")).toBe("");
    expect(normalizeText("")).toBe("");
  });
});
