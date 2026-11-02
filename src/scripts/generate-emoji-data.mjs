/**
 * Builds `app/utils/emoji-data.generated.json`, the emoji dataset behind the
 * picker, from `emojibase-data` (Unicode + CLDR, Spanish and English).
 *
 *   pnpm emoji:generate
 *
 * The output is committed, so the app has no runtime dependency on
 * `emojibase-data`; it is a devDependency used only by this script. Re-run it
 * after bumping the package (a test fails if the committed file is stale).
 *
 * Only base emoji are kept (no skin-tone variants), and nothing newer than
 * MAX_EMOJI_VERSION, because newer emoji render as empty boxes on older phones.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeText } from "../shared/text.ts";

export const MAX_EMOJI_VERSION = 15;

/** emojibase group index → picker tab id. Group 2 ("component") is skipped. */
export const GROUP_IDS = {
  0: "smileys",
  1: "people",
  3: "nature",
  4: "food",
  6: "activities",
  5: "travel",
  7: "objects",
  8: "symbols",
  9: "flags",
};

const TAB_ORDER = [
  "smileys",
  "people",
  "nature",
  "food",
  "activities",
  "travel",
  "objects",
  "symbols",
  "flags",
];

const stripVariation = (s) => s.replace(/\uFE0F/g, "");

function words(...texts) {
  return texts.flatMap((t) => (t ? normalizeText(t).split(" ") : [])).filter(Boolean);
}

/**
 * Pure transform from the emojibase datasets to the committed file's shape.
 *
 * @param {object} input
 * @param {{unicode: string, hexcode: string, label: string, tags?: string[], group?: number, order?: number}[]} input.en
 * @param {typeof input.en} input.es
 * @param {Record<string, string[]>} input.versions emoji version → hexcodes
 * @param {Record<string, string>} input.extras emoji → extra keywords (hand-written)
 * @param {number} [input.maxVersion]
 */
export function buildEmojiData({ en, es, versions, extras, maxVersion = MAX_EMOJI_VERSION }) {
  const versionOf = new Map();
  for (const [version, hexcodes] of Object.entries(versions)) {
    for (const hex of hexcodes) versionOf.set(hex, Number(version));
  }
  const spanish = new Map(es.map((e) => [e.hexcode, e]));
  const extraByEmoji = new Map(
    Object.entries(extras).map(([emoji, kw]) => [stripVariation(emoji), kw]),
  );

  const buckets = Object.fromEntries(TAB_ORDER.map((id) => [id, []]));
  for (const entry of en) {
    const tab = GROUP_IDS[entry.group];
    if (!tab) continue;
    const version = versionOf.get(entry.hexcode);
    if (version === undefined || version > maxVersion) continue;
    const es_ = spanish.get(entry.hexcode);
    const keywords = [
      ...new Set([
        ...words(es_?.label, ...(es_?.tags ?? [])),
        ...words(entry.label, ...(entry.tags ?? [])),
        ...words(extraByEmoji.get(stripVariation(entry.unicode))),
      ]),
    ].join(" ");
    buckets[tab].push({ order: entry.order ?? 0, row: [entry.unicode, keywords] });
  }

  const groups = {};
  for (const id of TAB_ORDER) {
    groups[id] = buckets[id].sort((a, b) => a.order - b.order).map((x) => x.row);
  }
  return { maxVersion, groups };
}

/** One emoji per line keeps diffs readable; still plain JSON. */
export function serialize(data) {
  const groups = Object.entries(data.groups)
    .map(
      ([id, rows]) =>
        `    ${JSON.stringify(id)}: [\n${rows.map((r) => `      ${JSON.stringify(r)}`).join(",\n")}\n    ]`,
    )
    .join(",\n");
  return `{\n  "maxVersion": ${data.maxVersion},\n  "groups": {\n${groups}\n  }\n}\n`;
}

export function readSources(appRoot) {
  const pkg = (path) =>
    JSON.parse(readFileSync(join(appRoot, "node_modules/emojibase-data", path), "utf8"));
  return {
    en: pkg("en/compact.json"),
    es: pkg("es/compact.json"),
    versions: pkg("versions/emoji.json"),
    extras: JSON.parse(readFileSync(join(appRoot, "scripts/emoji-extra-keywords.json"), "utf8")),
  };
}

export const OUTPUT = "app/utils/emoji-data.generated.json";

if (import.meta.main) {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const data = buildEmojiData(readSources(appRoot));
  writeFileSync(join(appRoot, OUTPUT), serialize(data));
  const total = Object.values(data.groups).reduce((n, g) => n + g.length, 0);
  console.log(`[pachas] wrote ${total} emoji to ${OUTPUT}`);
}
