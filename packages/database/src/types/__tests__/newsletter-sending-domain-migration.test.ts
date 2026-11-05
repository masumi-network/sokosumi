import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packageRoot, readMigrationSql } from "./schema-fixtures.js";

const migration = readMigrationSql(
  "20261029221913_newsletter_sending_domain_project",
);
const previousMigration = readMigrationSql(
  "20261029150000_newsletter_sending_domains",
);
const newsletterSchema = readFileSync(
  join(packageRoot, "prisma/newsletter.prisma"),
  "utf8",
);
const databaseUrl = process.env.NEWSLETTER_DOMAIN_MIGRATION_TEST_DATABASE_URL;

describe("newsletter sending domain project ownership", () => {
  it("keeps global domain and Resend uniqueness while replacing workspace ownership", () => {
    const model = newsletterSchema.split("model NewsletterSendingDomain {")[1];
    expect(model).toContain(
      '@unique(map: "newsletter_sending_domain_projectId_key")',
    );
    expect(model).not.toContain("workspaceId");
    for (const field of ["domain", "resendDomainId"]) {
      const index = `newsletter_sending_domain_${field}_key`;
      expect(model).toContain(`@unique(map: "${index}")`);
      expect(migration).not.toContain(`DROP INDEX "${index}"`);
    }
    expect(migration).toContain('REFERENCES "project"("id") ON DELETE CASCADE');
  });

  it("guards workspaces without projects before changing ownership in one transaction", () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration.indexOf("RAISE EXCEPTION")).toBeLessThan(
      migration.indexOf("ALTER TABLE"),
    );
    expect(migration).not.toMatch(/DELETE FROM|DROP TABLE/);
  });
});

// Only temporary tables are created. Point this at a disposable PostgreSQL
// database to exercise the migration's allocation and rollback semantics.
describe.skipIf(!databaseUrl)(
  "newsletter sending domain migration in Postgres",
  () => {
    let client: Client;

    beforeEach(async () => {
      client = new Client({ connectionString: databaseUrl });
      await client.connect();
      await client.query(`
      CREATE TEMP TABLE workspace (id UUID PRIMARY KEY);
      CREATE TEMP TABLE project (
        id UUID PRIMARY KEY,
        "workspaceId" UUID NOT NULL REFERENCES workspace(id),
        "createdAt" TIMESTAMP NOT NULL
      );
      CREATE TEMP TABLE newsletter (
        id UUID PRIMARY KEY,
        "projectId" UUID NOT NULL REFERENCES project(id),
        "workspaceId" UUID NOT NULL REFERENCES workspace(id),
        "createdAt" TIMESTAMP NOT NULL
      );
      ${previousMigration
        .replace(/CREATE TYPE[^;]+;/, "")
        .replaceAll('"NewsletterSendingDomainStatus"', "TEXT")
        .replace("CREATE TABLE", "CREATE TEMP TABLE")}
    `);
    });

    afterEach(async () => {
      await client.query("ROLLBACK");
      await client.end();
    });

    const id = (suffix: number) =>
      `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

    it("assigns only the oldest newsletter, falls back to the oldest project, and keeps global uniqueness", async () => {
      await client.query(`
      INSERT INTO workspace VALUES ('${id(1)}'), ('${id(2)}');
      INSERT INTO project VALUES
        ('${id(11)}', '${id(1)}', '2026-01-01'),
        ('${id(12)}', '${id(1)}', '2026-02-01'),
        ('${id(13)}', '${id(1)}', '2026-03-01'),
        ('${id(21)}', '${id(2)}', '2026-02-01'),
        ('${id(22)}', '${id(2)}', '2026-02-01'),
        ('${id(23)}', '${id(2)}', '2026-03-01');
      INSERT INTO newsletter VALUES
        ('${id(31)}', '${id(12)}', '${id(1)}', '2026-05-01'),
        ('${id(32)}', '${id(11)}', '${id(1)}', '2026-05-01'),
        ('${id(33)}', '${id(13)}', '${id(1)}', '2026-06-01');
      INSERT INTO newsletter_sending_domain
        (id, "updatedAt", "workspaceId", domain, "fromAddress", "resendDomainId", status)
      VALUES
        ('${id(41)}', now(), '${id(1)}', 'news.one.test', 'news@news.one.test', 'resend-one', 'VERIFIED'),
        ('${id(42)}', now(), '${id(2)}', 'news.two.test', 'news@news.two.test', 'resend-two', 'PENDING');
    `);
      await client.query(migration);
      const result = await client.query(
        'SELECT id, "projectId", domain, status FROM newsletter_sending_domain ORDER BY id',
      );
      expect(result.rows).toEqual([
        {
          id: id(41),
          projectId: id(12),
          domain: "news.one.test",
          status: "VERIFIED",
        },
        {
          id: id(42),
          projectId: id(21),
          domain: "news.two.test",
          status: "PENDING",
        },
      ]);
      await expect(
        client.query(`
        INSERT INTO newsletter_sending_domain
          (id, "updatedAt", "projectId", domain, "fromAddress", "resendDomainId")
        VALUES ('${id(43)}', now(), '${id(22)}', 'news.one.test', 'news@news.one.test', 'resend-three')
      `),
      ).rejects.toMatchObject({ code: "23505" });
      await client.query("DELETE FROM project WHERE id = $1", [id(21)]);
      expect(
        (await client.query("SELECT id FROM newsletter_sending_domain")).rows,
      ).toEqual([{ id: id(41) }]);
    });

    it("rolls back without losing a domain when its workspace has no project", async () => {
      await client.query(`
      INSERT INTO workspace VALUES ('${id(1)}');
      INSERT INTO newsletter_sending_domain
        (id, "updatedAt", "workspaceId", domain, "fromAddress", "resendDomainId")
      VALUES ('${id(41)}', now(), '${id(1)}', 'news.one.test', 'news@news.one.test', 'resend-one');
    `);
      await expect(client.query(migration)).rejects.toThrow(
        "requires a Project in every workspace with a sending domain",
      );
      await client.query("ROLLBACK");
      expect(
        (
          await client.query(
            'SELECT id, "workspaceId" FROM newsletter_sending_domain',
          )
        ).rows,
      ).toEqual([{ id: id(41), workspaceId: id(1) }]);
    });
  },
);
