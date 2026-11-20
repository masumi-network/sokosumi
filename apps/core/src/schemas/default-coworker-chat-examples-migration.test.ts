import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { coworkerMetadataSchema } from "./coworker.schema";

/**
 * The examples the default Coworkers' migrations write are chat starters: an
 * empty chat offers them as buttons and puts the clicked one in the message
 * box as written. Each is one short question in the Coworker's own field, and
 * fits on one line in the 281 px column of a 375 px phone (36 characters).
 */
function migration(name: string) {
  return readFileSync(
    new URL(
      `../../../../packages/database/prisma/migrations/${name}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  );
}

const JSON_LIST = String.raw`'(\[.*?\])'::jsonb`;

/** slug -> examples written by the first migration. */
const first = Object.fromEntries(
  [
    ...migration("20261120130000_default_coworker_chat_examples").matchAll(
      new RegExp(String.raw`\('([a-z]+)', ${JSON_LIST}\)`, "g"),
    ),
  ].map(([, slug, examples]) => [slug, JSON.parse(examples) as string[]]),
);

/** slug -> { previous, examples } from the shortening migration. */
const second = Object.fromEntries(
  [
    ...migration(
      "20261120140000_shorten_default_coworker_chat_examples",
    ).matchAll(
      new RegExp(String.raw`\('([a-z]+)', ${JSON_LIST}, ${JSON_LIST}\)`, "g"),
    ),
  ].map(([, slug, previous, examples]) => [
    slug,
    {
      previous: JSON.parse(previous) as string[],
      examples: JSON.parse(examples) as string[],
    },
  ]),
);

const DEFAULT_COWORKERS = ["alex", "elena", "hannah", "jamal", "maya"];

describe("default Coworker chat examples migrations", () => {
  it("cover every default Coworker", () => {
    expect(Object.keys(first).sort()).toEqual(DEFAULT_COWORKERS);
    expect(Object.keys(second).sort()).toEqual(DEFAULT_COWORKERS);
  });

  it.each(DEFAULT_COWORKERS)(
    "%s: the shortening only replaces what the first migration wrote",
    (slug) => {
      expect(second[slug].previous).toEqual(first[slug]);
    },
  );

  it.each(DEFAULT_COWORKERS)(
    "%s ends with three one-line questions",
    (slug) => {
      const { examples } = second[slug];
      expect(
        coworkerMetadataSchema.parse({ channels: {}, profile: { examples } })
          .profile?.examples,
      ).toEqual(examples);
      expect(examples).toHaveLength(3);
      expect(new Set(examples).size).toBe(3);
      for (const example of examples) {
        expect(example.length, example).toBeLessThanOrEqual(36);
        expect(example, example).toMatch(/^[A-Z][^.?!]*\?$/);
      }
    },
  );
});
