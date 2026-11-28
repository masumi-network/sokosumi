import { randomUUID } from "node:crypto";

function maintenanceUrl(source: string): string {
  const url = new URL(source);
  url.pathname = "/postgres";
  return url.toString();
}

/**
 * Copy the template into a database nobody else knows about.
 *
 * `CREATE DATABASE ... TEMPLATE ...` is a single statement and yields a
 * fully migrated, exclusively owned copy — which is what makes calling the
 * unscoped worker safe. The maintenance connection is closed immediately;
 * the caller owns the copy until it closes its pools and drops it.
 */
export async function copyPostgresTestDatabase(
  source: string,
  prefix:
    | "catalog_test"
    | "cron_test"
    | "credit_grant_test"
    | "credit_refund_test"
    | "files_import_test"
    | "job_reads_test",
) {
  const { Client } = await import("pg");

  const template = decodeURIComponent(
    new URL(source).pathname.replace(/^\//, ""),
  );
  const name = `${prefix}_${randomUUID().replace(/-/g, "")}`;

  const admin = new Client({ connectionString: maintenanceUrl(source) });
  await admin.connect();
  try {
    // Identifiers cannot be bound as parameters. Both are quoted; the name
    // is generated here and the template comes from the operator's own URL.
    await admin.query(
      `CREATE DATABASE "${name}" TEMPLATE "${template.replace(/"/g, '""')}"`,
    );
  } finally {
    await admin.end();
  }

  const target = new URL(source);
  target.pathname = `/${name}`;
  return {
    url: target.toString(),
    name,
    async drop() {
      const admin = new Client({ connectionString: maintenanceUrl(source) });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE "${name}"`);
      } finally {
        await admin.end();
      }
    },
  };
}
