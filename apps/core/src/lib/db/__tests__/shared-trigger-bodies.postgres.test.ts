/**
 * `packages/database/prisma/network-layout/shared-trigger-bodies.sql`: the
 * trigger bodies of the new layout. On today's layout the file refuses and
 * changes nothing. On the split layout (`onSplitLayout`), where
 * `split-network-layout.sh` applied it, no function of the file names a table,
 * type, sequence or function without its schema, and every trigger on a shared
 * table runs a function of the file or one that waits for the row's Network.
 * That the bodies differ from the migrations' in names only is checked by the
 * split script itself.
 */
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onSplitLayout } from "@/test/split-layout";

const BODIES_SQL = readFileSync(
  new URL(
    "../../../../../../packages/database/prisma/network-layout/shared-trigger-bodies.sql",
    import.meta.url,
  ),
  "utf8",
);
const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));
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

/** An object of `shared` named in a body, with the schema written before it. */
interface Reference {
  name: string;
  schema: string | null;
  kind: "TABLE" | "TYPE" | "FUNCTION" | "SEQUENCE";
}

interface Catalog {
  /** Tables, views and sequences of `shared` and its enums, each with the `ALTER` that renames it. */
  objects: Map<string, "TABLE" | "TYPE">;
  sequences: Set<string>;
  functions: Set<string>;
}

async function readCatalog(db: Queryable): Promise<Catalog> {
  const { rows } = await db.query<{
    name: string;
    kind: "TABLE" | "SEQUENCE" | "TYPE" | "FUNCTION";
  }>(`
    SELECT c.relname AS name, CASE c.relkind WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS kind
    FROM pg_class c
    WHERE c.relnamespace = 'shared'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
    UNION ALL
    SELECT t.typname, 'TYPE' FROM pg_type t
    WHERE t.typnamespace = 'shared'::regnamespace AND t.typtype = 'e'
    UNION ALL
    SELECT p.proname, 'FUNCTION' FROM pg_proc p WHERE p.pronamespace = 'shared'::regnamespace`);
  const named = (kind: string) =>
    rows.filter((row) => row.kind === kind).map((row) => row.name);
  return {
    objects: new Map([
      ...named("TABLE").map((name) => [name, "TABLE"] as const),
      ...named("SEQUENCE").map((name) => [name, "TABLE"] as const),
      ...named("TYPE").map((name) => [name, "TYPE"] as const),
    ]),
    sequences: new Set(named("SEQUENCE")),
    functions: new Set(named("FUNCTION")),
  };
}

/**
 * Every place in a body where an object of `shared` is looked up: a table,
 * view, sequence or enum by its name (also before a column list), a function
 * before `(`, a sequence as a whole string. Not a lookup: a column of
 * something (`r."kind"`), the qualifier of a column (`project.id`), an alias
 * after `AS`.
 */
function references(body: string, catalog: Catalog): Reference[] {
  const all = tokens(body);
  const found: Reference[] = [];
  const isSymbol = (token: Token | undefined, text: string) =>
    token?.kind === "symbol" && token.text === text;
  for (const [index, token] of all.entries()) {
    if (token.kind === "string") {
      const parts = token.text.replaceAll('"', "").split(".");
      const name = parts.at(-1) ?? "";
      if (parts.length <= 2 && catalog.sequences.has(name)) {
        found.push({
          name,
          schema: parts.length === 2 ? (parts[0] ?? null) : null,
          kind: "SEQUENCE",
        });
      }
      continue;
    }
    const before = all[index - 1];
    if (
      token.kind !== "name" ||
      isSymbol(all[index + 1], ".") ||
      (before?.kind === "name" && before.text === "as")
    ) {
      continue;
    }
    const kind =
      catalog.objects.get(token.text) ??
      (isSymbol(all[index + 1], "(") && catalog.functions.has(token.text)
        ? "FUNCTION"
        : undefined);
    if (!kind) continue;
    if (!isSymbol(before, ".")) {
      found.push({ name: token.text, schema: null, kind });
      continue;
    }
    const qualifier = all[index - 2];
    if (qualifier?.kind === "name" && SCHEMAS.includes(qualifier.text)) {
      found.push({ name: token.text, schema: qualifier.text, kind });
    }
  }
  return found;
}

/** The references of a body that do not name `shared`. */
function unqualified(body: string, catalog: Catalog): string[] {
  return references(body, catalog)
    .filter((reference) => reference.schema !== "shared")
    .map(
      (reference) =>
        `${reference.schema ? `${reference.schema}.` : ""}${reference.name}`,
    );
}

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

interface FunctionRow {
  oid: number;
  signature: string;
  body: string;
  version: string;
}

async function functionRows(db: Queryable): Promise<FunctionRow[]> {
  const { rows } = await db.query<FunctionRow>(
    `SELECT p.oid, p.oid::regprocedure::text AS signature, p.prosrc AS body, p.ctid::text AS version
     FROM pg_proc p
     WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     ORDER BY p.oid`,
  );
  return rows;
}

/** The functions the file writes, read from what applying it changes. */
async function functionsOfFile(pool: Pool): Promise<FunctionRow[]> {
  return rolledBack(pool, async (client) => {
    const before = new Map(
      (await functionRows(client)).map((row) => [row.oid, row.version]),
    );
    await client.query(BODIES_SQL);
    return (await functionRows(client)).filter(
      (row) => before.get(row.oid) !== row.version,
    );
  });
}

describe.runIf(ON_POSTGRES)("shared trigger bodies", () => {
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

      await expect(pool.query(BODIES_SQL)).rejects.toThrow(
        "needs the three-schema layout; missing schema: mainnet, preprod, shared",
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
        await expect(client.query(BODIES_SQL)).rejects.toThrow(
          "missing table: shared.calendar_invalidation_outbox, shared.chat_room,",
        );
        await client.query("ROLLBACK TO layout");
        expect(await functionRows(client)).toEqual(before);
      });
    });
  });

  describe.runIf(onSplitLayout)("on the split layout", () => {
    it("names the schema of every object in every function of the file", async () => {
      const catalog = await readCatalog(pool);
      const ofFile = await functionsOfFile(pool);
      const now = new Map(
        (await functionRows(pool)).map((row) => [row.oid, row]),
      );

      expect(ofFile).toHaveLength(41);
      expect(
        ofFile.flatMap((row) =>
          unqualified(now.get(row.oid)?.body ?? "", catalog).map(
            (name) => `${row.signature} names ${name} without shared.`,
          ),
        ),
      ).toEqual([]);
    });

    it("leaves only the triggers that wait for the row's Network on a function outside the file", async () => {
      const ofFile = new Set(
        (await functionsOfFile(pool)).map((row) => row.oid),
      );
      const { rows } = await pool.query<{ oid: number; signature: string }>(`
        SELECT DISTINCT p.oid, p.oid::regprocedure::text AS signature
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal AND c.relnamespace = 'shared'::regnamespace
        ORDER BY 2`);

      // Ticket 19 part 2 gives these the Network of the row.
      expect(
        rows.filter((row) => !ofFile.has(row.oid)).map((row) => row.signature),
      ).toEqual([
        "shared.scope_notification_to_workspace_membership()",
        "shared.sync_history_from_project_image_asset()",
        "shared.sync_history_from_project_image_job_charge()",
        "shared.sync_history_from_task()",
        "shared.sync_history_from_task_event()",
      ]);
    });

    it("finds each kind of name without its schema", async () => {
      const catalog = await readCatalog(pool);

      expect(
        unqualified(
          `BEGIN
            UPDATE "task" SET "status" = 'CANCELED'::"TaskStatus" WHERE "id" = NEW."id";
            INSERT INTO "task_identifier_alias" ("projectId", "number", "taskId") VALUES (NULL, 1, NULL);
            PERFORM 1 FROM public."workspace" w JOIN shared."project" ON project.id = w.id;
            PERFORM enqueue_calendar_invalidation(NULL, NULL, NULL, NULL);
            PERFORM nextval('calendar_invalidation_revision_seq');
            PERFORM nextval('"calendar_invalidation_revision_seq"');
            RETURN NEW;
          END`,
          catalog,
        ),
      ).toEqual([
        "task",
        "TaskStatus",
        "task_identifier_alias",
        "public.workspace",
        "enqueue_calendar_invalidation",
        "calendar_invalidation_revision_seq",
        "calendar_invalidation_revision_seq",
      ]);
    });

    it("takes an alias, a column and a column's qualifier for no lookup", async () => {
      const catalog = await readCatalog(pool);

      expect(
        unqualified(
          `SELECT project.id, c."organization", w.id AS workspace
           FROM shared."project" JOIN shared."contact" c ON true JOIN shared."workspace" AS w ON true
           WHERE "contact_search"."document" IS NULL -- from "task"`,
          catalog,
        ),
      ).toEqual([]);
    });

    it("is refused when any object its bodies name is not where and what they name", async () => {
      const catalog = await readCatalog(pool);
      const ofFile = await functionsOfFile(pool);
      const named = new Map<string, "TABLE" | "TYPE">();
      for (const row of ofFile) {
        for (const reference of references(row.body, catalog)) {
          if (reference.kind !== "FUNCTION") {
            named.set(
              reference.name,
              catalog.objects.get(reference.name) ?? "TABLE",
            );
          }
        }
      }
      expect([...named.keys()]).toEqual(
        expect.arrayContaining([
          "chat_room_message",
          "contact_search",
          "task_identifier_alias",
          "calendar_invalidation_revision_seq",
        ]),
      );
      const moves = [
        ...[...named].map(([name, alter]) => ({
          name: `shared.${/^[a-z_]+$/.test(name) ? name : `"${name}"`}`,
          sql: `ALTER ${alter} shared."${name}" RENAME TO moved_19a`,
        })),
        ...ofFile.map((row) => ({
          name: row.signature,
          sql: `ALTER FUNCTION ${row.signature} SET SCHEMA public`,
        })),
        { name: "mainnet", sql: "ALTER SCHEMA mainnet RENAME TO moved_19a" },
        { name: "preprod", sql: "ALTER SCHEMA preprod RENAME TO moved_19a" },
        {
          name: "public.unaccent(text)",
          sql: "ALTER FUNCTION public.unaccent(text) RENAME TO moved_19a",
        },
        {
          name: "missing sequence: shared.calendar_invalidation_revision_seq",
          sql: `ALTER SEQUENCE shared.calendar_invalidation_revision_seq RENAME TO moved_19a;
                CREATE TABLE shared.calendar_invalidation_revision_seq (id integer)`,
        },
        {
          name: "missing table: shared.task",
          sql: `ALTER TABLE shared."task" RENAME TO moved_19a;
                CREATE SEQUENCE shared."task"`,
        },
      ];

      const accepted: string[] = [];
      for (const move of moves) {
        await rolledBack(pool, async (client) => {
          await client.query(move.sql);
          const refusal = await client.query(BODIES_SQL).then(
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
