import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { coworkerMetadataSchema } from "./coworker.schema";

/**
 * The examples the default Coworkers' migration writes are chat starters: an
 * empty chat offers them as buttons and puts the clicked one in the message
 * box as written. Each is one short question in the Coworker's own field.
 */
const migration = readFileSync(
  new URL(
    "../../../../packages/database/prisma/migrations/20261120130000_default_coworker_chat_examples/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const rows = Object.fromEntries(
  [...migration.matchAll(/\('([a-z]+)', '(\[.*\])'::jsonb\)/g)].map(
    ([, slug, examples]) => [slug, JSON.parse(examples) as string[]],
  ),
);

describe("default Coworker chat examples migration", () => {
  it("covers every default Coworker", () => {
    expect(Object.keys(rows).sort()).toEqual([
      "alex",
      "elena",
      "hannah",
      "jamal",
      "maya",
    ]);
  });

  it.each(Object.entries(rows))(
    "%s gets three short one-sentence questions",
    (_slug, examples) => {
      expect(
        coworkerMetadataSchema.parse({ channels: {}, profile: { examples } })
          .profile?.examples,
      ).toEqual(examples);
      expect(examples).toHaveLength(3);
      expect(new Set(examples).size).toBe(3);
      for (const example of examples) {
        expect(example.length, example).toBeLessThanOrEqual(45);
        expect(example, example).toMatch(/^[A-Z][^.?!]*\?$/);
      }
    },
  );
});
