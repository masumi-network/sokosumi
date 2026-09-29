import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
/**
 * From source, not from `@sokosumi/utils`.
 *
 * The package entry point resolves to `dist`, so importing it compares the
 * migration against whatever the last build produced — and a tag added to the
 * source but not yet built would let this pass while source and migration
 * disagreed. Verified by adding one: through the package entry, the guard
 * passed. CI builds utils before typecheck, so it would have caught it there
 * and not here, which is the worst of both.
 */
import { curatedFileVocabularyRows } from "../../../utils/src/file-curated-vocabulary.js";

/**
 * The backfill migration and the curated list still agree.
 *
 * A checked-in migration has to inline its data — it cannot import the list —
 * so there are now two copies of twenty rows, and the second one can never be
 * corrected after it ships. That is the right trade for a migration, and it is
 * also exactly the shape that drifts: someone adds a tag to
 * `file-curated-vocabulary.ts`, new workspaces get it, existing workspaces
 * quietly do not, and nothing says so.
 *
 * This compares the two. It does not check that the migration ran — it checks
 * that what it inserts is what the product thinks the vocabulary is.
 */

const MIGRATIONS = [
  "20260928140000_seed_curated_file_vocabulary",
  "20260928210000_widen_curated_file_vocabulary",
].map((name) =>
  readFileSync(
    fileURLToPath(
      new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url),
    ),
    "utf8",
  ),
);

/**
 * The `VALUES` tuples, as (kind, displayName, normalizedName, description).
 *
 * Parsed rather than pattern-matched loosely: a regex that merely counted
 * occurrences would pass a migration whose descriptions had all been
 * truncated.
 */
function migrationRows(migration: string): {
  kind: string;
  displayName: string;
  normalizedName: string;
  description: string;
}[] {
  const start = migration.indexOf("VALUES");
  const end = migration.indexOf(") AS v(", start);
  expect(start, "the migration no longer has a VALUES block").toBeGreaterThan(
    -1,
  );
  expect(end, "the migration no longer has the v() alias").toBeGreaterThan(-1);

  const body = migration.slice(start, end);
  const rows: {
    kind: string;
    displayName: string;
    normalizedName: string;
    description: string;
  }[] = [];

  // One tuple per line, four single-quoted fields, '' as an escaped quote.
  const tuple = /\(\s*((?:'(?:[^']|'')*'\s*,\s*){3}'(?:[^']|'')*')\s*\)/g;
  for (const match of body.matchAll(tuple)) {
    const fields = [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map((field) =>
      field[1].replace(/''/g, "'"),
    );
    rows.push({
      kind: fields[0],
      displayName: fields[1],
      normalizedName: fields[2],
      description: fields[3],
    });
  }
  return rows;
}

/** Each migration adds its own rows, so order across them is not the list's. */
const byName = <T extends { kind: string; displayName: string }>(rows: T[]) =>
  [...rows].sort((a, b) =>
    `${a.kind}${a.displayName}`.localeCompare(`${b.kind}${b.displayName}`),
  );

describe("the curated vocabulary backfill", () => {
  it("inserts exactly the curated list", () => {
    expect(
      byName(MIGRATIONS.flatMap(migrationRows)),
      "The backfill and packages/utils/src/file-curated-vocabulary.ts have " +
        "drifted. A label added to the list without a migration reaches new " +
        "workspaces and silently never reaches existing ones.",
    ).toEqual(byName(curatedFileVocabularyRows()));
  });

  describe.each(MIGRATIONS)("statement %#", (migration) => {
    it("is idempotent and does not overwrite", () => {
      // The two properties that make it safe to run twice against production,
      // asserted here so a later edit cannot quietly drop either one. Behaviour
      // is proven in file-curated-vocabulary.postgres.test.ts; this is the
      // statement-level guard.
      expect(migration).toContain(
        'ON CONFLICT ("workspaceId", "kind", "normalizedName") DO NOTHING',
      );
      expect(
        migration.includes("DO UPDATE"),
        "an upsert would rewrite a rubric that existing suggestions were " +
          "scored against, and would claim product authorship of a human's label",
      ).toBe(false);
    });

    it("is one set-based statement over the workspace table", () => {
      // Not 20xN rows shipped from application code: at this shape the cost is
      // one sequential scan and the behaviour is the same at ten thousand
      // workspaces as at a million, so no row count gates the deploy.
      expect(migration).toContain('FROM "workspace" w');
      expect(migration).toContain("CROSS JOIN");
      expect(migration.match(/INSERT INTO/g) ?? []).toHaveLength(1);
    });

    it("leaves createdByUserId null, which is the provenance marker", () => {
      expect(migration).toContain('"createdByUserId"');
      expect(migration).toMatch(/NULL\s*\n\s*FROM "workspace" w/);
    });
  });
});
