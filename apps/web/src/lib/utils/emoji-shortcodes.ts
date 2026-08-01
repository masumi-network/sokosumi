import { gemoji } from "gemoji";

const DEFAULT_EMOJI_RESULT_CAP = 20;
const DEFAULT_FREQUENTLY_USED_CAP = 24;
const EMOJI_QUERY_PATTERN = /^[a-z0-9_+-]*$/i;
const FREQUENTLY_USED_SECTION_ID = "frequently-used" as const;

/** Public emoji row — unicode + shortcode name only. */
export interface EmojiShortcodeMatch {
  name: string;
  emoji: string;
}

export type EmojiCategoryId =
  | "smileys-emotion"
  | "people-body"
  | "animals-nature"
  | "food-drink"
  | "travel-places"
  | "activities"
  | "objects"
  | "symbols"
  | "flags";

export interface EmojiCategoryMeta {
  id: EmojiCategoryId;
  gemojiCategory: string;
  navEmoji: string;
  messageKey: string;
}

export interface EmojiCatalogEntry {
  emoji: string;
  names: readonly string[];
  tags: readonly string[];
  description: string;
  categoryId: EmojiCategoryId;
}

export interface EmojiCatalogSection {
  id: EmojiCategoryId | typeof FREQUENTLY_USED_SECTION_ID;
  categoryId: EmojiCategoryId | null;
  emojis: readonly EmojiCatalogEntry[];
}

interface EmojiCategoryDefinition {
  id: EmojiCategoryId;
  gemojiCategory: string;
  navEmoji: string;
  messageKey: string;
}

interface SearchEmojiCatalogOptions {
  cap?: number;
  categoryId?: EmojiCategoryId;
}

interface ListEmojiCatalogSectionsOptions {
  frequentlyUsed?: string[];
}

const EMOJI_CATEGORY_DEFINITIONS: readonly EmojiCategoryDefinition[] = [
  {
    id: "smileys-emotion",
    gemojiCategory: "Smileys & Emotion",
    navEmoji: "😀",
    messageKey: "smileysEmotion",
  },
  {
    id: "people-body",
    gemojiCategory: "People & Body",
    navEmoji: "👋",
    messageKey: "peopleBody",
  },
  {
    id: "animals-nature",
    gemojiCategory: "Animals & Nature",
    navEmoji: "🐵",
    messageKey: "animalsNature",
  },
  {
    id: "food-drink",
    gemojiCategory: "Food & Drink",
    navEmoji: "🍇",
    messageKey: "foodDrink",
  },
  {
    id: "travel-places",
    gemojiCategory: "Travel & Places",
    navEmoji: "🌍",
    messageKey: "travelPlaces",
  },
  {
    id: "activities",
    gemojiCategory: "Activities",
    navEmoji: "🎃",
    messageKey: "activities",
  },
  {
    id: "objects",
    gemojiCategory: "Objects",
    navEmoji: "👓",
    messageKey: "objects",
  },
  {
    id: "symbols",
    gemojiCategory: "Symbols",
    navEmoji: "🏧",
    messageKey: "symbols",
  },
  {
    id: "flags",
    gemojiCategory: "Flags",
    navEmoji: "🏁",
    messageKey: "flags",
  },
];

const CATEGORY_BY_GEMOJI = new Map(
  EMOJI_CATEGORY_DEFINITIONS.map((definition) => [
    definition.gemojiCategory,
    definition,
  ]),
);

const EMOJI_CATEGORIES: readonly EmojiCategoryMeta[] =
  EMOJI_CATEGORY_DEFINITIONS.map(
    ({ id, gemojiCategory, navEmoji, messageKey }) => ({
      id,
      gemojiCategory,
      navEmoji,
      messageKey,
    }),
  );

function buildEmojiCatalog(): {
  catalog: readonly EmojiCatalogEntry[];
  byCategory: ReadonlyMap<EmojiCategoryId, readonly EmojiCatalogEntry[]>;
  byEmoji: ReadonlyMap<string, EmojiCatalogEntry>;
  shortcodeRegistry: readonly EmojiShortcodeMatch[];
  emojiByName: ReadonlyMap<string, string>;
} {
  const byEmoji = new Map<string, EmojiCatalogEntry>();
  const byCategoryBuckets = new Map<EmojiCategoryId, EmojiCatalogEntry[]>(
    EMOJI_CATEGORY_DEFINITIONS.map((definition) => [definition.id, []]),
  );

  for (const entry of gemoji) {
    const category = CATEGORY_BY_GEMOJI.get(entry.category);
    if (!category) continue;
    if (byEmoji.has(entry.emoji)) continue;

    const catalogEntry: EmojiCatalogEntry = {
      emoji: entry.emoji,
      names: entry.names,
      tags: entry.tags,
      description: entry.description,
      categoryId: category.id,
    };
    byEmoji.set(entry.emoji, catalogEntry);
    byCategoryBuckets.get(category.id)?.push(catalogEntry);
  }

  const catalog = EMOJI_CATEGORY_DEFINITIONS.flatMap(
    (definition) => byCategoryBuckets.get(definition.id) ?? [],
  );

  const shortcodeRegistry = catalog
    .flatMap((entry) =>
      entry.names.map((name) => ({ name, emoji: entry.emoji })),
    )
    .toSorted((a, b) => a.name.localeCompare(b.name));

  const emojiByName = new Map(
    shortcodeRegistry.map((entry) => [entry.name, entry.emoji]),
  );

  const byCategory = new Map<EmojiCategoryId, readonly EmojiCatalogEntry[]>(
    EMOJI_CATEGORY_DEFINITIONS.map((definition) => [
      definition.id,
      byCategoryBuckets.get(definition.id) ?? [],
    ]),
  );

  return { catalog, byCategory, byEmoji, shortcodeRegistry, emojiByName };
}

const {
  catalog: EMOJI_CATALOG,
  byCategory: EMOJIS_BY_CATEGORY,
  byEmoji: EMOJI_BY_GLYPH,
  shortcodeRegistry: EMOJI_SHORTCODE_REGISTRY,
  emojiByName: EMOJI_BY_NAME,
} = buildEmojiCatalog();

export function listEmojiCategories(): readonly EmojiCategoryMeta[] {
  return EMOJI_CATEGORIES;
}

export function listEmojisByCategory(
  categoryId: EmojiCategoryId,
): readonly EmojiCatalogEntry[] {
  return EMOJIS_BY_CATEGORY.get(categoryId) ?? [];
}

export function listEmojiCatalogSections(
  options: ListEmojiCatalogSectionsOptions = {},
): EmojiCatalogSection[] {
  const sections: EmojiCatalogSection[] = [];
  const frequentlyUsed = resolveFrequentlyUsedEmojis(
    options.frequentlyUsed ?? [],
  );

  if (frequentlyUsed.length > 0) {
    sections.push({
      id: FREQUENTLY_USED_SECTION_ID,
      categoryId: null,
      emojis: frequentlyUsed,
    });
  }

  for (const category of EMOJI_CATEGORIES) {
    sections.push({
      id: category.id,
      categoryId: category.id,
      emojis: listEmojisByCategory(category.id),
    });
  }

  return sections;
}

/**
 * Ranked catalog search: name-prefix > name-includes > tag/description.
 * Empty query → stable alphabetical list (capped only when `cap` is set).
 * Omit `cap` to return all ranked matches.
 */
export function searchEmojiCatalog(
  query: string,
  options: SearchEmojiCatalogOptions = {},
): EmojiCatalogEntry[] {
  const hasCap = options.cap !== undefined;
  const limit = hasCap ? Math.max(0, options.cap ?? 0) : null;
  if (limit === 0) return [];

  const source = options.categoryId
    ? listEmojisByCategory(options.categoryId)
    : EMOJI_CATALOG;

  const normalizedQuery = query.toLowerCase().trim();
  if (normalizedQuery.length === 0) {
    const sorted = [...source].toSorted((a, b) =>
      (a.names[0] ?? "").localeCompare(b.names[0] ?? ""),
    );
    return limit === null ? sorted : sorted.slice(0, limit);
  }

  const prefixMatches: EmojiCatalogEntry[] = [];
  const includesMatches: EmojiCatalogEntry[] = [];
  const tagOrDescriptionMatches: EmojiCatalogEntry[] = [];

  for (const entry of source) {
    if (entry.names.some((name) => name.startsWith(normalizedQuery))) {
      prefixMatches.push(entry);
      continue;
    }
    if (entry.names.some((name) => name.includes(normalizedQuery))) {
      includesMatches.push(entry);
      continue;
    }
    if (
      entry.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)) ||
      entry.description.toLowerCase().includes(normalizedQuery)
    ) {
      tagOrDescriptionMatches.push(entry);
    }
  }

  const ranked = [
    ...prefixMatches,
    ...includesMatches,
    ...tagOrDescriptionMatches,
  ];
  return limit === null ? ranked : ranked.slice(0, limit);
}

/**
 * Autocomplete filter over shortcode names (all aliases).
 * Thin map of name-ranked shortcodes → `{ name, emoji }`.
 * Empty query → stable alphabetical top-N.
 */
export function filterEmojiShortcodes(
  query: string,
  cap: number = DEFAULT_EMOJI_RESULT_CAP,
): EmojiShortcodeMatch[] {
  const limit = Math.max(0, cap);
  if (limit === 0) return [];

  const normalizedQuery = query.toLowerCase();
  if (normalizedQuery.length === 0) {
    return EMOJI_SHORTCODE_REGISTRY.slice(0, limit).map((entry) => ({
      name: entry.name,
      emoji: entry.emoji,
    }));
  }

  const prefixMatches: EmojiShortcodeMatch[] = [];
  const includesMatches: EmojiShortcodeMatch[] = [];

  for (const entry of EMOJI_SHORTCODE_REGISTRY) {
    if (entry.name.startsWith(normalizedQuery)) {
      prefixMatches.push({ name: entry.name, emoji: entry.emoji });
      continue;
    }
    if (entry.name.includes(normalizedQuery)) {
      includesMatches.push({ name: entry.name, emoji: entry.emoji });
    }
  }

  return [...prefixMatches, ...includesMatches].slice(0, limit);
}

/**
 * Optional: exact `:name:` just closed at caret → unicode for auto-insert.
 */
export function matchExactEmojiShortcodeClosed(
  text: string,
  caret: number,
): { triggerStart: number; end: number; emoji: string } | null {
  const clampedCaret = Math.max(0, Math.min(caret, text.length));
  if (clampedCaret < 3) return null;
  if (text[clampedCaret - 1] !== ":") return null;

  let openIndex = -1;
  for (let index = clampedCaret - 2; index >= 0; index -= 1) {
    const char = text[index] ?? "";
    if (char.trim() === "") break;
    if (char === ":") {
      openIndex = index;
      break;
    }
  }
  if (openIndex < 0) return null;
  if (openIndex > 0 && (text[openIndex - 1] ?? "").trim() !== "") {
    return null;
  }

  const name = text.slice(openIndex + 1, clampedCaret - 1);
  if (name.length === 0 || !EMOJI_QUERY_PATTERN.test(name)) return null;
  if (name.includes(":")) return null;

  const emoji = EMOJI_BY_NAME.get(name.toLowerCase());
  if (!emoji) return null;

  return { triggerStart: openIndex, end: clampedCaret, emoji };
}

/** MRU prepend + dedupe; newest first. Pure — no storage. */
export function recordFrequentlyUsedEmoji(
  current: readonly string[],
  emoji: string,
  cap: number = DEFAULT_FREQUENTLY_USED_CAP,
): string[] {
  const limit = Math.max(0, cap);
  if (limit === 0 || emoji.length === 0) return [];

  const next = [emoji, ...current.filter((item) => item !== emoji)];
  return next.slice(0, limit);
}

/** Resolve stored glyphs to catalog entries; drop unknown / duplicates. */
export function resolveFrequentlyUsedEmojis(
  stored: readonly string[],
): EmojiCatalogEntry[] {
  const resolved: EmojiCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const emoji of stored) {
    if (seen.has(emoji)) continue;
    const entry = EMOJI_BY_GLYPH.get(emoji);
    if (!entry) continue;
    seen.add(emoji);
    resolved.push(entry);
  }

  return resolved;
}

export {
  DEFAULT_EMOJI_RESULT_CAP as EMOJI_RESULT_CAP,
  DEFAULT_FREQUENTLY_USED_CAP as FREQUENTLY_USED_EMOJI_CAP,
  FREQUENTLY_USED_SECTION_ID,
};
