import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { MAX_EMOJI_VERSION, OUTPUT, buildEmojiData, readSources, serialize } from "../scripts/generate-emoji-data.mjs";

const root = resolve(__dirname, "..");

const en = [
  { hexcode: "1F600", unicode: "😀", label: "grinning face", tags: ["happy"], group: 0, order: 1 },
  { hexcode: "1F44D", unicode: "👍", label: "thumbs up", tags: ["like"], group: 1, order: 2 },
  { hexcode: "1F3FB", unicode: "🏻", label: "light skin tone", group: 2, order: 3 },
  { hexcode: "1F1E6", unicode: "🇦", label: "regional indicator A" },
  { hexcode: "2764", unicode: "❤️", label: "red heart", tags: ["love"], group: 0, order: 4 },
  { hexcode: "1FAE8", unicode: "🫨", label: "shaking face", group: 0, order: 5 },
  { hexcode: "1F999", unicode: "🦙", label: "llama", group: 3, order: 6 },
];
const es = [
  { hexcode: "1F600", unicode: "😀", label: "cara sonriendo", tags: ["feliz"] },
  { hexcode: "2764", unicode: "❤️", label: "corazón rojo", tags: ["amor"] },
];
const versions = {
  "1": ["1F600", "1F44D"],
  "0.6": ["2764"],
  "15": ["1F999"],
  "15.1": ["1FAE8"],
};

describe("buildEmojiData", () => {
  const data = buildEmojiData({ en, es, versions, extras: { "❤": "querer" } });

  it("keeps base emoji, in order, under their tab", () => {
    expect(data.groups.smileys.map((r: string[]) => r[0])).toEqual(["😀", "❤️"]);
    expect(data.groups.people.map((r: string[]) => r[0])).toEqual(["👍"]);
    expect(data.groups.nature.map((r: string[]) => r[0])).toEqual(["🦙"]);
  });

  it("drops components, ungrouped entries and emoji newer than the cap", () => {
    const flat = Object.values(data.groups).flat() as string[][];
    const emoji = flat.map((r) => r[0]);
    expect(emoji).not.toContain("🏻");
    expect(emoji).not.toContain("🇦");
    expect(emoji).not.toContain("🫨");
    expect(MAX_EMOJI_VERSION).toBe(15);
  });

  it("merges Spanish, English and extra keywords without accents or duplicates", () => {
    const heart = data.groups.smileys.find((r: string[]) => r[0] === "❤️")![1];
    expect(heart.split(" ")).toEqual(
      expect.arrayContaining(["corazon", "rojo", "amor", "red", "heart", "love", "querer"]),
    );
    const words = heart.split(" ");
    expect(new Set(words).size).toBe(words.length);
  });

  it("serialises to valid JSON that round-trips", () => {
    expect(JSON.parse(serialize(data))).toEqual(data);
  });
});

describe("committed emoji data", () => {
  it("is up to date with emojibase-data (run `pnpm emoji:generate`)", () => {
    const expected = serialize(buildEmojiData(readSources(root)));
    const actual = readFileSync(join(root, OUTPUT), "utf8");
    expect(actual === expected).toBe(true);
  });
});
