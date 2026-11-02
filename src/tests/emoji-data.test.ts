import { beforeAll, describe, expect, it } from "vitest";
import {
  EMOJI_GROUP_IDS,
  loadEmojiGroups,
  searchEmojis,
  type EmojiGroup,
} from "../app/utils/emoji-data";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
let groups: EmojiGroup[] = [];
let all: { e: string; k: string }[] = [];

beforeAll(async () => {
  groups = await loadEmojiGroups();
  all = groups.flatMap((g) => g.emojis);
});

describe("emoji data", () => {
  it("has every tab, in order, each with plenty of emoji", () => {
    expect(groups.map((g) => g.id)).toEqual([...EMOJI_GROUP_IDS]);
    for (const g of groups) expect(g.emojis.length, g.id).toBeGreaterThan(50);
  });

  it("covers the full set of base emoji", () => {
    expect(all.length).toBeGreaterThan(1700);
  });

  it("has no duplicate emoji", () => {
    const seen = new Set<string>();
    for (const { e } of all) {
      expect(seen.has(e), `duplicate ${e}`).toBe(false);
      seen.add(e);
    }
  });

  it("stores exactly one grapheme per entry", () => {
    for (const { e } of all) {
      expect([...graphemes.segment(e)], e).toHaveLength(1);
    }
  });

  it("gives every entry searchable keywords", () => {
    for (const { e, k } of all) expect(k.length, e).toBeGreaterThan(1);
  });

  it("has no skin-tone variants", () => {
    for (const { e } of all) expect(/[\u{1F3FB}-\u{1F3FF}]/u.test(e), e).toBe(false);
  });

  it("includes every seeded category icon and the default group emoji", () => {
    const set = new Set(all.map((x) => x.e));
    for (const e of ["🧾", "🍜", "🛒", "🚕", "🏠", "💡", "🎬", "✈️", "🛍️"]) {
      expect(set.has(e), e).toBe(true);
    }
  });
});

describe("searchEmojis", () => {
  it("finds emojis by Spanish and English keywords, ignoring accents", () => {
    expect(searchEmojis(groups, "avión").map((x) => x.e)).toContain("✈️");
    expect(searchEmojis(groups, "plane").map((x) => x.e)).toContain("✈️");
    expect(searchEmojis(groups, "PIÑA").map((x) => x.e)).toContain("🍍");
  });

  it("finds emoji that were missing from the old hand-written list", () => {
    const dinos = searchEmojis(groups, "dinosaur").map((x) => x.e);
    expect(dinos).toContain("🦖");
    expect(dinos).toContain("🦕");
    expect(searchEmojis(groups, "cupcake").map((x) => x.e)).toContain("🧁");
    expect(searchEmojis(groups, "patines").length).toBeGreaterThan(0);
  });

  it("keeps the hand-written expense keywords", () => {
    expect(searchEmojis(groups, "supermercado").map((x) => x.e)).toContain("🛒");
    expect(searchEmojis(groups, "gasolinera").map((x) => x.e)).toContain("⛽");
  });

  it("requires every word to match", () => {
    const hits = searchEmojis(groups, "corazon azul").map((x) => x.e);
    expect(hits).toContain("💙");
    expect(hits).not.toContain("💚");
  });

  it("matches the emoji character itself, with or without its variation selector", () => {
    expect(searchEmojis(groups, "🍕").map((x) => x.e)).toContain("🍕");
    expect(searchEmojis(groups, "✈").map((x) => x.e)).toContain("✈️");
  });

  it("honours the result limit", () => {
    expect(searchEmojis(groups, "cara", 10)).toHaveLength(10);
  });

  it("returns nothing for a blank query or a miss", () => {
    expect(searchEmojis(groups, "   ")).toEqual([]);
    expect(searchEmojis(groups, "zzzzqq")).toEqual([]);
  });
});
