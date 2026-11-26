/**
 * `packages/database/prisma/network-layout/shared-trigger-bodies.sql`: the
 * trigger bodies of the new layout. On today's layout the file refuses and
 * changes nothing. On the split layout (`onSplitLayout`), where
 * `split-network-layout.sh` applied it, no trigger on a shared table runs a
 * body that names a table, type, sequence or function without its schema.
 * That the bodies differ from the migrations' in names only is checked by the
 * split script itself.
 */
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onSplitLayout } from "@/test/split-layout";

const FILE = readFileSync(
  new URL(
    "../../../../../../packages/database/prisma/network-layout/shared-trigger-bodies.sql",
    import.meta.url,
  ),
  "utf8",
);
const onPostgres = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const SCHEMAS = ["shared", "mainnet", "preprod", "public"];

type Queryable = Pool | PoolClient;

interface Token {
  kind: "name" | "string" | "symbol";
  text: string;
}

/**
 * A function body as names, strings and symbols; comments are dropped. A bare
 * name is folded to lowercase as PostgreSQL folds it, a quoted one keeps its
 * spelling. Not read: a backslash-escaped quote inside an `E''` string.
 */
function tokens(body: string): Token[] {
  const found: Token[] = [];
  const pattern =
    /--[^\n]*|\/\*[\s\S]*?\*\/|'((?:[^']|'')*)'|"((?:[^"]|"")*)"|([A-Za-z_][A-Za-z0-9_$]*)|\S/g;
  for (const match of body.matchAll(pattern)) {
    const [text, string, quoted, bare] = match;
    if (string !== undefined) found.push({ kind: "string", text: string });
    else if (quoted !== undefined) found.push({ kind: "name", text: quoted });
    else if (bare !== undefined)
      found.push({ kind: "name", text: bare.toLowerCase() });
    else if (!text.startsWith("--") && !text.startsWith("/*"))
      found.push({ kind: "symbol", text });
  }
  return found;
}

/** A name in a body that could be an object of the database, with the schema written before it. */
interface Reference {
  name: string;
  schema: string | null;
  /** Followed by `(`. */
  called: boolean;
  /** A whole string, as `nextval` takes its sequence. */
  string: boolean;
}

/**
 * Every name that stands where a table, type or function can stand: not a
 * column of something (`r."kind"`), and not the qualifier of a column
 * (`project.id`). An alias spelled like a table is reported as that table.
 */
function references(body: string): Reference[] {
  const all = tokens(body);
  const found: Reference[] = [];
  const isDot = (token: Token | undefined) =>
    token?.kind === "symbol" && token.text === ".";
  for (const [index, token] of all.entries()) {
    if (token.kind === "string") {
      const [first, second, ...rest] = token.text.split(".");
      if (first && rest.length === 0) {
        found.push({
          name: second ?? first,
          schema: second ? first : null,
          called: false,
          string: true,
        });
      }
      continue;
    }
    if (token.kind !== "name" || isDot(all[index + 1])) continue;
    const called = all[index + 1]?.text === "(";
    if (!isDot(all[index - 1])) {
      found.push({ name: token.text, schema: null, called, string: false });
      continue;
    }
    const before = all[index - 2];
    if (before?.kind === "name" && SCHEMAS.includes(before.text)) {
      found.push({
        name: token.text,
        schema: before.text,
        called,
        string: false,
      });
    }
  }
  return found;
}

interface Catalog {
  /** Tables, views and sequences of `shared` and its enums, each with the `ALTER` that renames it. */
  shared: Map<string, "TABLE" | "TYPE">;
  sequences: Set<string>;
  /** Tables and enums of a Network. */
  network: Set<string>;
  /** Body of each function of `shared`, by name. */
  functions: Map<string, string>;
  triggers: { trigger: string; table: string; schema: string; name: string }[];
}

async function readCatalog(db: Queryable): Promise<Catalog> {
  const objects = await db.query<{
    schema: string;
    name: string;
    kind: "TABLE" | "SEQUENCE" | "TYPE";
  }>(`
    SELECT n.nspname AS schema, c.relname AS name,
      CASE c.relkind WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS kind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('shared', 'mainnet') AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
    UNION ALL
    SELECT n.nspname, t.typname, 'TYPE'
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname IN ('shared', 'mainnet') AND t.typtype = 'e'`);
  const functions = await db.query<{ name: string; body: string }>(`
    SELECT p.proname AS name, p.prosrc AS body
    FROM pg_proc p WHERE p.pronamespace = 'shared'::regnamespace`);
  const triggers = await db.query<Catalog["triggers"][number]>(`
    SELECT t.tgname AS trigger, c.relname AS "table", fn.nspname AS schema, p.proname AS name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace fn ON fn.oid = p.pronamespace
    WHERE NOT t.tgisinternal AND c.relnamespace = 'shared'::regnamespace
    ORDER BY c.relname, t.tgname`);
  const of = (schema: string) =>
    objects.rows.filter((row) => row.schema === schema);
  return {
    shared: new Map(
      of("shared").map((row) => [
        row.name,
        row.kind === "TYPE" ? "TYPE" : "TABLE",
      ]),
    ),
    sequences: new Set(
      of("shared")
        .filter((row) => row.kind === "SEQUENCE")
        .map((row) => row.name),
    ),
    network: new Set(of("mainnet").map((row) => row.name)),
    functions: new Map(functions.rows.map((row) => [row.name, row.body])),
    triggers: triggers.rows,
  };
}

interface TriggerReport {
  /** Trigger functions that reach a Network table: their bodies wait for the row's Network. */
  waiting: string[];
  /** Tables, sequences and types the other bodies name with `shared.`, each with the `ALTER` that renames it. */
  named: Map<string, "TABLE" | "TYPE">;
  problems: string[];
}

/** Each trigger on a shared table, with the functions its function calls. */
async function checkTriggers(db: Queryable): Promise<TriggerReport> {
  const catalog = await readCatalog(db);
  const report: TriggerReport = {
    waiting: [],
    named: new Map(),
    problems: [],
  };
  const isObject = (reference: Reference) => {
    if (reference.string) return catalog.sequences.has(reference.name);
    if (reference.called) return catalog.functions.has(reference.name);
    return catalog.shared.has(reference.name);
  };

  for (const trigger of catalog.triggers) {
    const reached = new Map<string, Reference[]>();
    const queue = [trigger.name];
    for (const name of queue) {
      if (reached.has(name)) continue;
      const found = references(catalog.functions.get(name) ?? "");
      reached.set(name, found);
      queue.push(
        ...found
          .filter((reference) => reference.called)
          .map((reference) => reference.name)
          .filter((callee) => catalog.functions.has(callee)),
      );
    }
    const all = [...reached.values()].flat();
    if (
      all.some(
        (reference) =>
          !reference.called &&
          !reference.string &&
          catalog.network.has(reference.name),
      )
    ) {
      if (!report.waiting.includes(trigger.name)) {
        report.waiting.push(trigger.name);
      }
      continue;
    }
    if (trigger.schema !== "shared") {
      report.problems.push(
        `${trigger.trigger} on ${trigger.table} calls ${trigger.schema}.${trigger.name}`,
      );
    }
    for (const [name, found] of reached) {
      for (const reference of found.filter(isObject)) {
        if (reference.schema !== "shared") {
          report.problems.push(
            `${name} (${trigger.trigger} on ${trigger.table}) names ${reference.schema ? `${reference.schema}.` : ""}${reference.name} without shared.`,
          );
        } else if (!reference.called) {
          report.named.set(
            reference.name,
            catalog.shared.get(reference.name) ?? "TABLE",
          );
        }
      }
    }
  }
  report.waiting.sort();
  report.problems = [...new Set(report.problems)];
  return report;
}

/** Runs in a transaction that is always rolled back. */
async function rolledBack<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await run(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function functionRows(db: Queryable) {
  const { rows } = await db.query(
    "SELECT p.oid, p.pronamespace::regnamespace::text AS schema, p.proname, p.prosrc FROM pg_proc p WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace) ORDER BY p.oid",
  );
  return rows;
}

describe.runIf(onPostgres)("shared trigger bodies", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe.runIf(!onSplitLayout)("on today's layout", () => {
    it("refuses and leaves every function as it was", async () => {
      const before = await functionRows(pool);

      await expect(pool.query(FILE)).rejects.toThrow(
        "needs the three-schema layout; missing schema: shared, mainnet, preprod",
      );

      expect(await functionRows(pool)).toEqual(before);
    });

    it("refuses three schemas that do not hold the tables", async () => {
      const before = await functionRows(pool);

      await rolledBack(pool, async (client) => {
        await client.query(
          "CREATE SCHEMA shared; CREATE SCHEMA mainnet; CREATE SCHEMA preprod",
        );
        await client.query("SAVEPOINT layout");
        await expect(client.query(FILE)).rejects.toThrow(
          "missing table or sequence: shared.calendar_invalidation_outbox, shared.calendar_invalidation_revision_seq, shared.chat_room,",
        );
        await client.query("ROLLBACK TO layout");
        expect(await functionRows(client)).toEqual(before);
      });
    });
  });

  describe.runIf(onSplitLayout)("on the split layout", () => {
    it("leaves no trigger on a shared table with a name that lacks its schema", async () => {
      const report = await checkTriggers(pool);

      expect(report.problems).toEqual([]);
      // Ticket 19 part 2 gives these the Network of the row.
      expect(report.waiting).toEqual([
        "scope_notification_to_workspace_membership",
        "sync_history_from_project_image_asset",
        "sync_history_from_project_image_job_charge",
        "sync_history_from_task",
        "sync_history_from_task_event",
      ]);
    });

    it("finds each kind of name without its schema", async () => {
      const report = await rolledBack(pool, async (client) => {
        await client.query(`
          CREATE FUNCTION shared.probe_19a() RETURNS trigger LANGUAGE plpgsql AS $probe$
          BEGIN
            UPDATE "task" SET "status" = 'CANCELED'::"TaskStatus" WHERE "id" = NEW."id";
            PERFORM 1 FROM public."workspace" w JOIN shared."project" ON project.id = w.id;
            PERFORM enqueue_calendar_invalidation(NULL, NULL, NULL, NULL);
            PERFORM nextval('calendar_invalidation_revision_seq');
            RETURN NEW;
          END
          $probe$;
          CREATE TRIGGER probe_19a AFTER UPDATE ON shared."task"
            FOR EACH ROW EXECUTE FUNCTION shared.probe_19a()`);
        return checkTriggers(client);
      });

      expect(report.problems).toEqual([
        "probe_19a (probe_19a on task) names task without shared.",
        "probe_19a (probe_19a on task) names TaskStatus without shared.",
        "probe_19a (probe_19a on task) names public.workspace without shared.",
        "probe_19a (probe_19a on task) names enqueue_calendar_invalidation without shared.",
        "probe_19a (probe_19a on task) names calendar_invalidation_revision_seq without shared.",
      ]);
    });

    it("is refused when any object its bodies name is not where they name it", async () => {
      const { named } = await checkTriggers(pool);
      const moves = [
        ...[...named].map(([name, alter]) => ({
          name: `shared.${/^[a-z_]+$/.test(name) ? name : `"${name}"`}`,
          sql: `ALTER ${alter} shared."${name}" RENAME TO moved_19a`,
        })),
        { name: "mainnet", sql: "ALTER SCHEMA mainnet RENAME TO moved_19a" },
        { name: "preprod", sql: "ALTER SCHEMA preprod RENAME TO moved_19a" },
        {
          name: "public.unaccent(text)",
          sql: "ALTER FUNCTION public.unaccent(text) RENAME TO moved_19a",
        },
      ];
      expect(moves.length).toBeGreaterThan(25);

      const accepted: string[] = [];
      for (const move of moves) {
        await rolledBack(pool, async (client) => {
          await client.query(move.sql);
          const refusal = await client.query(FILE).then(
            () => "applied",
            (error: Error) => error.message,
          );
          if (
            !refusal.startsWith(
              "shared-trigger-bodies.sql needs the three-schema layout; missing",
            ) ||
            !refusal.includes(move.name)
          ) {
            accepted.push(`${move.name}: ${refusal}`);
          }
        });
      }

      expect(accepted).toEqual([]);
    });
  });
});
