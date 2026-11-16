import { Pool, type PoolClient } from "pg";

const sql: string[] = [];
let installed = false;

function statementText(config: unknown) {
  if (typeof config === "string") return config;
  if (config && typeof config === "object" && "text" in config) {
    return String((config as { text?: unknown }).text ?? "");
  }
  return "";
}

/**
 * Records SQL from every pool checked out after this runs, including a
 * transaction client. Transaction control statements are left out. Installed
 * from the query-count tests; forwarding every argument keeps pg's callback
 * form working.
 */
export function installSqlCounter() {
  if (installed) return;
  installed = true;
  const connect = Pool.prototype.connect as (
    this: Pool,
    callback?: (
      error: Error | undefined,
      client: PoolClient,
      done: () => void,
    ) => void,
  ) => Promise<PoolClient>;
  const wrapped = new WeakSet<PoolClient>();

  function record(config: unknown) {
    const text = statementText(config).replace(/\s+/g, " ").trim();
    if (text.length === 0) return;
    if (
      /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET TRANSACTION)\b/i.test(text)
    ) {
      return;
    }
    sql.push(text);
  }

  function wrap(client: PoolClient) {
    if (wrapped.has(client)) return client;
    wrapped.add(client);
    const query = client.query;
    client.query = ((...args: unknown[]) => {
      record(args[0]);
      return query.apply(client, args as never);
    }) as PoolClient["query"];
    return client;
  }

  Pool.prototype.connect = function connectAndCount(
    this: Pool,
    callback?: unknown,
  ) {
    if (typeof callback === "function") {
      return connect.call(this, ((
        error: Error | undefined,
        client: PoolClient,
        done: () => void,
      ) => {
        if (client) wrap(client);
        (
          callback as (
            error: Error | undefined,
            client: PoolClient,
            done: () => void,
          ) => void
        )(error, client, done);
      }) as never);
    }
    return connect.call(this).then((client) => wrap(client));
  } as Pool["connect"];
}

export function recordedSql() {
  return sql;
}

/** The repeated user-summary select Sentry fingerprints as one N+1 query. */
export function userSummaryReads(statements: readonly string[]) {
  return statements.filter(
    (query) =>
      query.includes('FROM "public"."user"') && query.includes('"image"'),
  ).length;
}
