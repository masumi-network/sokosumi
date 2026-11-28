/**
 * What a payer's recorded comparison needs (`*-spend.postgres.test.ts`): the
 * statements Core's pool sent, grouped into transactions, values without what
 * differs between two runs, and the base file the payer's code on
 * `origin/main` wrote, compared with the debit as `spend` writes it now.
 *
 * The pool is observed through `@vercel/functions`, which each test file
 * mocks itself (a mock lives in the file it applies to):
 *
 *   vi.mock("@vercel/functions", async (importOriginal) => {
 *     const actual = await importOriginal<typeof import("@vercel/functions")>();
 *     const { observePool } = await import("@/test/spend-comparison");
 *     return {
 *       ...actual,
 *       attachDatabasePool: (pool: Pool) => {
 *         observePool(pool);
 *         actual.attachDatabasePool(pool);
 *       },
 *     };
 *   });
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Pool, PoolClient } from "pg";
import { expect } from "vitest";
import { onSplitLayout } from "./split-layout";

interface SentStatement {
  connection: number;
  pendingAtSend?: number[];
  text: string;
  values: unknown[];
  /** When it was sent, on one clock shared with `answered`. */
  sent: number;
  /** When PostgreSQL answered it, or its error arrived; null until then. */
  answered: number | null;
  /** The flow that sent it (`inFlow`): `"call"` unless one was named. */
  flow: string;
}

/** The flow a statement is sent from, carried through its async calls. */
const flows = new AsyncLocalStorage<string>();

/**
 * Runs `work` as a flow of its own: its statements are told apart from those
 * of another flow running at the same time, as two requests at once are, so
 * whether one flow awaited each answer is decided within that flow.
 */
export function inFlow<T>(name: string, work: () => Promise<T>): Promise<T> {
  return flows.run(name, work);
}
/** What `statements` reads of a statement sent. */
type StatementSent = Pick<SentStatement, "connection" | "text" | "values">;
/** What Core's pool sent while a call was observed, per connection. */
const sent = {
  observing: false,
  pending: undefined as Set<number> | undefined,
  connections: 0,
  /** A counter, not a time: two events never share a tick. */
  ticks: 0,
  log: [] as SentStatement[],
};

/** Records what each new connection of the pool sends while observing. */
export function observePool(pool: Pool): void {
  pool.on("connect", (client: PoolClient) => {
    sent.connections += 1;
    const connection = sent.connections;
    const query = client.query.bind(client) as (...a: unknown[]) => unknown;
    (client as { query: unknown }).query = (...args: unknown[]) => {
      if (sent.observing) {
        const [first, second] = args;
        const config =
          typeof first === "string"
            ? { text: first, values: second }
            : (first as { text: string; values?: unknown });
        const pending = sent.pending;
        const index = sent.log.length;
        const entry: SentStatement = {
          ...(pending && { pendingAtSend: [...pending] }),
          connection,
          text: config.text,
          values: Array.isArray(config.values) ? config.values : [],
          sent: ++sent.ticks,
          answered: null,
          flow: flows.getStore() ?? "call",
        };
        sent.log.push(entry);
        pending?.add(index);
        const answered = () => {
          entry.answered ??= ++sent.ticks;
          pending?.delete(index);
        };
        // A query with a callback (the pool's own `query`) is answered when
        // the callback runs; one without returns a promise.
        const last = args.at(-1);
        if (typeof last === "function") {
          args[args.length - 1] = (...results: unknown[]) => {
            answered();
            return (last as (...r: unknown[]) => unknown)(...results);
          };
        }
        const result = query(...args);
        if (result instanceof Promise) {
          // A derived promise: the caller still gets the original and its error.
          result.then(answered, answered);
        }
        return result;
      }
      return query(...args);
    };
  });
}

/**
 * What a caller sees of an error: its name, message, HTTP status and the
 * public error kind, which an `HTTPException` of `@/helpers/error` carries in
 * its `cause` and Core's error handler answers with.
 */
export function thrown(error: unknown) {
  const { name, message, status, cause } = error as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    cause?: unknown;
  };
  const kind =
    typeof cause === "object" && cause !== null
      ? (cause as { kind?: unknown }).kind
      : undefined;
  return {
    name,
    message,
    ...(status === undefined ? {} : { status }),
    ...(kind === undefined ? {} : { kind }),
  };
}

/**
 * `Date.now()` once the clock has left the current millisecond. An observed
 * call's start taken this way lies after every row written before it, also
 * in the milliseconds a time column keeps, so "within the call" never takes
 * in a write that ended in the same millisecond the call started.
 */
export async function nextMillisecond(): Promise<number> {
  const before = Date.now();
  while (Date.now() <= before) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return Date.now();
}

/** Runs `call` and returns its outcome with what the pool sent meanwhile. */
export async function observing<T>(
  call: () => Promise<T>,
  options?: { trackResponses: boolean },
): Promise<{ outcome: T | { threw: unknown }; log: SentStatement[] }> {
  sent.log = [];
  sent.pending = options?.trackResponses ? new Set() : undefined;
  sent.observing = true;
  try {
    return { outcome: await call(), log: sent.log };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { outcome: { threw: thrown(error) }, log: sent.log };
  } finally {
    sent.observing = false;
  }
}

/** Compare the exact driver statement, allowing only the two layouts’ schema qualifiers. */
export function statementDigest(sql: string): string {
  const text = onSplitLayout
    ? sql
        .replaceAll('"mainnet".', '"public".')
        .replaceAll('"shared".', '"public".')
    : sql;
  return createHash("sha256").update(text).digest("hex");
}

export interface Statement {
  sql: string;
  values: unknown[];
}

/** Each statement's transaction, numbered as `statements` orders them. */
function inTransactions(log: readonly SentStatement[]) {
  const open = new Map<number, number>();
  let count = 0;
  return log.map((entry) => {
    let transaction = open.get(entry.connection) ?? null;
    if (/^\s*BEGIN\b/i.test(entry.text)) {
      transaction = count++;
      open.set(entry.connection, transaction);
    } else if (/^\s*(COMMIT|ROLLBACK)\b/i.test(entry.text)) {
      open.delete(entry.connection);
    }
    return { entry, transaction };
  });
}

/**
 * Within each flow (`inFlow`), every statement sent before an earlier one of
 * the same flow was answered, inside a transaction or outside, as
 * `"<flow> <later> before <earlier>"` with each statement numbered in its
 * flow's send order: `[]` when the flow awaited every answer before it sent
 * again. A statement never answered counts as not answered.
 */
export function sentBeforeAnswered(log: readonly SentStatement[]): string[] {
  const byFlow = new Map<string, SentStatement[]>();
  for (const entry of log) {
    const flow = byFlow.get(entry.flow) ?? [];
    flow.push(entry);
    byFlow.set(entry.flow, flow);
  }
  return [...byFlow].flatMap(([name, flow]) =>
    flow.flatMap((later, at) =>
      flow
        .slice(0, at)
        .flatMap((earlier, before) =>
          earlier.answered === null || earlier.answered > later.sent
            ? [`${name} ${at} before ${before}`]
            : [],
        ),
    ),
  );
}

/**
 * The order every statement was sent in, across flows and transactions and
 * outside them: runs of `"<n> <flow> in transaction <t>"` or
 * `"<n> <flow> outside"`, with `t` numbered as `statements` orders the
 * transactions.
 */
export function sendOrder(log: readonly SentStatement[]): string[] {
  const runs: { where: string; count: number }[] = [];
  for (const { entry, transaction } of inTransactions(log)) {
    const where = `${entry.flow} ${
      transaction === null ? "outside" : `in transaction ${transaction}`
    }`;
    const last = runs.at(-1);
    if (last?.where === where) last.count += 1;
    else runs.push({ where, count: 1 });
  }
  return runs.map(({ where, count }) => `${count} ${where}`);
}

/**
 * The statements as PostgreSQL received them. A transaction is the statements
 * of one connection from its BEGIN to its COMMIT or ROLLBACK, in the order
 * sent, with the values bound. Statements outside a transaction can run side
 * by side, so they are counted per text. On the split layout the schema names
 * differ and are written as today's.
 *
 * `asSent` keeps every schema name as sent, and keeps each statement outside
 * a transaction with its values, in the order sent: the caller makes them
 * plain and sorts them.
 */
export function statements(
  log: readonly StatementSent[],
  options?: { asSent?: false },
): { transactions: Statement[][]; outsideTransactions: Record<string, number> };
export function statements(
  log: readonly StatementSent[],
  options: { asSent: true },
): { transactions: Statement[][]; outsideTransactions: Statement[] };
export function statements(
  log: readonly StatementSent[],
  { asSent = false }: { asSent?: boolean } = {},
) {
  const open = new Map<number, Statement[]>();
  const transactions: Statement[][] = [];
  const outside = new Map<string, number>();
  const outsideAsSent: Statement[] = [];
  for (const { connection, text, values } of log) {
    const collapsed = text.replace(/\s+/g, " ").trim();
    const sql = asSent
      ? collapsed
      : collapsed.replace(/"(shared|mainnet)"\./g, '"public".');
    const transaction = open.get(connection);
    if (/^BEGIN\b/i.test(sql)) {
      const started = [{ sql, values }];
      open.set(connection, started);
      transactions.push(started);
    } else if (transaction) {
      transaction.push({ sql, values });
      if (/^(COMMIT|ROLLBACK)\b/i.test(sql)) open.delete(connection);
    } else if (asSent) {
      outsideAsSent.push({ sql, values });
    } else {
      outside.set(sql, (outside.get(sql) ?? 0) + 1);
    }
  }
  return {
    transactions,
    outsideTransactions: asSent
      ? outsideAsSent
      : Object.fromEntries(
          [...outside].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        ),
  };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TIME =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g;

/**
 * Plain data without what differs between two runs: a value in `labels` is
 * its name, a time is `<time>`, and an id the run made is `<id n>`, numbered
 * in the order the ids first appear, so two places that hold one id still
 * agree.
 */
export function plain(
  value: unknown,
  labels: ReadonlyMap<string, string>,
): unknown {
  let text = JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
  for (const [random, name] of labels) text = text.replaceAll(random, name);
  const made = new Map<string, string>();
  text = text.replace(UUID, (id) => {
    if (!made.has(id)) made.set(id, `<id ${made.size + 1}>`);
    return made.get(id) ?? id;
  });
  return JSON.parse(text.replace(TIME, "<time>"));
}

/*
 * The one difference from `origin/main`, statement by statement. There the
 * debit was Prisma's nested create: three statements.
 */
const MAIN_INSERT_DEBIT =
  'INSERT INTO "public"."Transaction" ("id","createdAt","updatedAt","amount","userId","organizationId") VALUES ($1,$2,$3,$4,$5,$6) RETURNING "public"."Transaction"."id"';
const mainInsertConsumptions = (count: number) =>
  `INSERT INTO "public"."credit_consumption" ("id","createdAt","amount","bucketId","transactionId") VALUES ${Array.from(
    { length: count },
    (_unused, row) =>
      `(${[1, 2, 3, 4, 5].map((column) => `$${row * 5 + column}`).join(",")})`,
  ).join(", ")}`;
const MAIN_READ_DEBIT_BACK =
  'SELECT "public"."Transaction"."id" FROM "public"."Transaction" WHERE "public"."Transaction"."id" = $1 LIMIT $2 OFFSET $3';
/*
 * Now the credit bucket repository's `recordSpend` writes it, as it has
 * written the Task charge since #8224: two statements of raw SQL, which name
 * the Network's schema.
 */
const NOW_INSERT_DEBIT =
  'INSERT INTO "public"."Transaction" (id, "createdAt", "updatedAt", amount, "userId", "organizationId") VALUES ($1, $2, $3, $4, $5, $6)';
const NOW_INSERT_CONSUMPTIONS =
  'INSERT INTO "public"."credit_consumption" (id, "createdAt", amount, "bucketId", "transactionId") SELECT c.id, $1::timestamp(3), c.amount, c."bucketId", $2::text FROM unnest($3::text[], $4::bigint[], $5::text[]) AS c(id, amount, "bucketId")';

/**
 * A transaction recorded on `origin/main`, with its debit written as
 * `recordSpend` writes it: the same values in the same place, every other
 * statement untouched. It refuses a debit that is not exactly the three
 * statements above.
 */
function withTheDebitAsWrittenNow(transaction: Statement[]): Statement[] {
  const at = transaction.findIndex(({ sql }) => sql === MAIN_INSERT_DEBIT);
  if (at === -1) return transaction;
  const [debit, consumptions, readBack] = transaction.slice(at, at + 3);
  if (!debit || !consumptions || !readBack) throw new Error("A debit is cut");
  const debitId = debit.values[0];
  const written = Array.from(
    { length: consumptions.values.length / 5 },
    (_unused, row) => consumptions.values.slice(row * 5, row * 5 + 5),
  );
  expect([consumptions.sql, readBack]).toEqual([
    mainInsertConsumptions(written.length),
    { sql: MAIN_READ_DEBIT_BACK, values: [debitId, "1", "0"] },
  ]);
  // One time and one debit for every consumption, as the one statement binds.
  expect(written.map((row) => [row[1], row[4]])).toEqual(
    written.map(() => [debit.values[1], debitId]),
  );
  return [
    ...transaction.slice(0, at),
    { sql: NOW_INSERT_DEBIT, values: debit.values },
    {
      sql: NOW_INSERT_CONSUMPTIONS,
      values: [
        debit.values[1],
        debitId,
        written.map((row) => row[0]),
        written.map((row) => row[2]),
        written.map((row) => row[3]),
      ],
    },
    ...transaction.slice(at + 3),
  ];
}

interface Observed {
  statements: { transactions: Statement[][] };
}

/**
 * A payer's base file. While `recording`, `expectAsOnBase` writes what it
 * observes under the key; otherwise it compares: the answer, the rows and
 * every statement are `origin/main`'s, only the debit's own statements are
 * the ones `recordSpend` sends. A payer whose debit `recordSpend` already
 * wrote on `origin/main` passes `debitMoved: false`: nothing is rewritten,
 * and a compensating refund's own insert stays as recorded.
 */
export function baseFile(
  path: string,
  recording: boolean,
  { debitMoved = true }: { debitMoved?: boolean } = {},
) {
  const recorded = (): Record<string, unknown> =>
    existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>)
      : {};
  return {
    /**
     * `rewrite` names a further difference of one case, which the caller
     * states and checks. The base file holds what was observed, whole; the
     * rewrite applies to the base's and to the observed transactions alike,
     * only when they are compared.
     */
    expectAsOnBase(
      key: string,
      observed: unknown,
      rewrite: (transactions: Statement[][]) => Statement[][] = (same) => same,
    ): void {
      if (recording) {
        writeFileSync(
          path,
          `${JSON.stringify({ ...recorded(), [key]: observed }, null, 2)}\n`,
        );
        return;
      }
      const base = recorded()[key] as Observed | undefined;
      if (!base) throw new Error(`The base file has no case "${key}"`);
      const now = observed as Observed;
      expect({
        ...now,
        statements: {
          ...now.statements,
          transactions: rewrite(now.statements.transactions),
        },
      }).toEqual({
        ...base,
        statements: {
          ...base.statements,
          transactions: debitMoved
            ? rewrite(base.statements.transactions).map(
                withTheDebitAsWrittenNow,
              )
            : rewrite(base.statements.transactions),
        },
      });
    },
  };
}
