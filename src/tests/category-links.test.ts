import { describe, expect, it } from "vitest";
import {
  MAX_LINK_TITLE,
  buildTitleLinkIndex,
  categoryAfterTitleEdit,
  categoryForTitle,
  resolveImportCategory,
} from "../shared/category-links";
import { readCategoryLinkPatch, readNewCategoryLink } from "../server/utils/category-links";

const err = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a throw");
};

describe("title matching", () => {
  const index = buildTitleLinkIndex([
    { title: "Mercadona", categoryId: 3 },
    { title: "Gas natural", categoryId: 5 },
  ]);

  it("matches the whole title, ignoring case, accents and extra spaces", () => {
    expect(categoryForTitle(index, "mercadona")).toBe(3);
    expect(categoryForTitle(index, "  MERCADONÁ ")).toBe(3);
    expect(categoryForTitle(index, "gas   Natural")).toBe(5);
  });

  it("does not match part of a title", () => {
    expect(categoryForTitle(index, "Compra Mercadona centro")).toBeNull();
    expect(categoryForTitle(index, "Mercad")).toBeNull();
    expect(categoryForTitle(index, "gas")).toBeNull();
  });

  it("returns null for a blank title or an empty index", () => {
    expect(categoryForTitle(index, "   ")).toBeNull();
    expect(categoryForTitle(buildTitleLinkIndex([]), "Mercadona")).toBeNull();
  });

  it("keeps the first link when two titles normalise the same", () => {
    const dup = buildTitleLinkIndex([
      { title: "Café", categoryId: 1 },
      { title: "cafe", categoryId: 2 },
    ]);
    expect(categoryForTitle(dup, "CAFE")).toBe(1);
  });
});

describe("link input validation", () => {
  it("returns the normalised title, which is the only form stored", () => {
    expect(readNewCategoryLink({ title: "  Mercadoná   Centro ", categoryId: 4 })).toEqual({
      title: "mercadona centro",
      categoryId: 4,
    });
  });

  it("rejects missing, blank and over-long titles", () => {
    expect(err(() => readNewCategoryLink({ categoryId: 1 }))).toBe("link_title_invalid");
    expect(err(() => readNewCategoryLink({ title: "   ", categoryId: 1 }))).toBe(
      "link_title_invalid",
    );
    expect(err(() => readNewCategoryLink({ title: 5, categoryId: 1 }))).toBe(
      "link_title_invalid",
    );
    expect(
      err(() => readNewCategoryLink({ title: "x".repeat(MAX_LINK_TITLE + 1), categoryId: 1 })),
    ).toBe("link_title_invalid");
    expect(readNewCategoryLink({ title: "x".repeat(MAX_LINK_TITLE), categoryId: 1 }).title).toHaveLength(
      MAX_LINK_TITLE,
    );
    // The cap applies to what was typed, not to the shorter normalised form.
    expect(
      err(() => readNewCategoryLink({ title: "é".repeat(MAX_LINK_TITLE + 1), categoryId: 1 })),
    ).toBe("link_title_invalid");
  });

  it("rejects category ids that are not positive integers", () => {
    for (const categoryId of [undefined, "1", 1.5, 0, -2, null, NaN, Infinity]) {
      expect(err(() => readNewCategoryLink({ title: "A", categoryId }))).toBe(
        "link_category_invalid",
      );
    }
  });

  it("allows a partial update but not an empty one", () => {
    expect(readCategoryLinkPatch({ title: "Nuevo" })).toEqual({ title: "nuevo" });
    expect(readCategoryLinkPatch({ categoryId: 2 })).toEqual({ categoryId: 2 });
    expect(err(() => readCategoryLinkPatch({}))).toBe("link_nothing_to_update");
    expect(err(() => readCategoryLinkPatch({ title: "" }))).toBe("link_title_invalid");
  });
});

describe("category after a title edit", () => {
  it("switches to the linked category", () => {
    expect(categoryAfterTitleEdit("1", false, 3, 1)).toBe("3");
  });

  it("never overrides a category the user picked by hand", () => {
    expect(categoryAfterTitleEdit("7", true, 3, 1)).toBe("7");
    expect(categoryAfterTitleEdit("7", true, null, 1)).toBe("7");
  });

  it("falls back to the default category when the title has no link", () => {
    expect(categoryAfterTitleEdit("3", false, null, 1)).toBe("1");
    expect(categoryAfterTitleEdit("1", false, null, 1)).toBe("1");
  });

  it("keeps the current category when there is no link and no known default", () => {
    expect(categoryAfterTitleEdit("3", false, null, null)).toBe("3");
  });
});

describe("import category resolution", () => {
  const index = buildTitleLinkIndex([{ title: "Gas natural", categoryId: 5 }]);

  it("lets a title link override the mapped CSV category", () => {
    expect(resolveImportCategory(index, "  GAS Natural ", "2", "1")).toBe("5");
  });

  it("uses the mapped CSV category when the title is not linked", () => {
    expect(resolveImportCategory(index, "Cena", "2", "1")).toBe("2");
  });

  it("falls back when there is neither a link nor a mapping", () => {
    expect(resolveImportCategory(index, "Cena", undefined, "1")).toBe("1");
    expect(resolveImportCategory(index, "Cena", "", "1")).toBe("1");
  });
});
