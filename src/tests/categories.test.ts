import { describe, expect, it } from "vitest";
import { defaultCategory } from "../shared/categories";

describe("defaultCategory", () => {
  const list = [
    { id: 4, title: "Comida" },
    { id: 1, title: "General" },
    { id: 9, title: "Otros" },
  ];

  it("picks the category titled General wherever it sits in the list", () => {
    expect(defaultCategory(list)?.id).toBe(1);
  });

  it("falls back to the first category when General was renamed", () => {
    expect(defaultCategory([{ id: 4, title: "Comida" }, { id: 9, title: "Otros" }])?.id).toBe(4);
  });

  it("returns undefined for an empty list", () => {
    expect(defaultCategory([])).toBeUndefined();
  });
});
