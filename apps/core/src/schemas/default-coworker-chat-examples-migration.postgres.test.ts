/**
 * Real-Postgres proof that the default Coworkers' chat examples migrations
 * change only `profile.examples`, and that the shortening migration leaves an
 * example list edited since the first one alone.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/schemas/default-coworker-chat-examples-migration.postgres.test.ts
 *
 * Runs the migrations inside a transaction that is always rolled back, so the
 * fixtures (and any real rows with these slugs) are left as they were.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import { coworkerMetadataSchema } from "./coworker.schema";

const [migrationSql, shortenSql] = [
  "20261120130000_default_coworker_chat_examples",
  "20261120140000_shorten_default_coworker_chat_examples",
].map((name) =>
  readFileSync(
    new URL(
      `../../../../packages/database/prisma/migrations/${name}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  ),
);

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const offers = [
  { title: "Competitive analysis", prompt: "Run a long task prompt." },
];
const hannah = {
  channels: { email: "hannah@example.com" },
  profile: { llm: ["Claude"], hosting: "EU", capabilities: ["Research"] },
  offers,
  extra: { kept: true },
};
const elena = {
  channels: {},
  profile: { examples: ["Build a go-to-market plan for a new offering"] },
  offers,
};
const other = { channels: {}, profile: { examples: ["Leave me alone"] } };

class Rollback extends Error {}

describe.skipIf(!enabled)("default Coworker chat examples migration", () => {
  it("sets only profile.examples and keeps every other key", async () => {
    const vendorId = randomUUID();
    const otherSlug = `other-${vendorId}`;
    let after: Record<string, unknown> = {};

    await prisma
      .$transaction(async (tx) => {
        await tx.vendor.create({
          data: { id: vendorId, slug: vendorId, name: "Examples vendor" },
        });
        const rows: [string, object][] = [
          ["hannah", hannah],
          ["elena", elena],
          ["jamal", {}],
          ["maya", {}],
          ["alex", { channels: {} }],
          [otherSlug, other],
        ];
        for (const [slug, metadata] of rows) {
          await tx.coworker.upsert({
            where: { slug },
            create: { slug, name: slug, vendorId, metadata },
            update: { metadata },
          });
        }
        // Both empty shapes a row can hold: SQL NULL and JSON null.
        await tx.$executeRaw`UPDATE "coworker" SET "metadata" = NULL WHERE "slug" = 'jamal'`;
        await tx.$executeRaw`UPDATE "coworker" SET "metadata" = 'null'::jsonb WHERE "slug" = 'maya'`;

        await tx.$executeRawUnsafe(migrationSql);
        // An admin edits Maya's examples between the two migrations.
        await tx.$executeRaw`UPDATE "coworker" SET "metadata" = jsonb_set("metadata", '{profile,examples}', '["Edited by an admin?"]') WHERE "slug" = 'maya'`;
        await tx.$executeRawUnsafe(shortenSql);

        const found = await tx.coworker.findMany({
          where: { slug: { in: rows.map(([slug]) => slug) } },
          select: { slug: true, metadata: true },
        });
        after = Object.fromEntries(found.map((c) => [c.slug, c.metadata]));
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });

    expect(after.hannah).toEqual({
      ...hannah,
      profile: {
        ...hannah.profile,
        examples: [
          "Who are our main competitors?",
          "What do our customers care about?",
          "How does our social media stack up?",
        ],
      },
    });
    expect(after.elena).toMatchObject({ channels: {}, offers });
    expect((after.elena as typeof elena).profile.examples).toHaveLength(3);
    expect((after.elena as typeof elena).profile.examples).not.toContain(
      elena.profile.examples[0],
    );
    expect(after.jamal).toEqual({
      channels: {},
      profile: {
        examples: [
          "Can you map our customer journey?",
          "Where should our media budget go?",
          "How do we follow up with new leads?",
        ],
      },
    });
    expect(after.maya).toEqual({
      channels: {},
      profile: { examples: ["Edited by an admin?"] },
    });
    expect(after[otherSlug]).toEqual(other);
    for (const slug of ["hannah", "elena", "jamal", "maya", "alex"]) {
      expect(() => coworkerMetadataSchema.parse(after[slug])).not.toThrow();
    }
  });
});
