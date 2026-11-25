// Test only. Run after split-network-layout.sh on a disposable PostgreSQL
// database. PREPARE analyzes statements without executing them.
import { createHash } from "node:crypto";
import { globSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";
import { Client } from "pg";

import {
  createSqlTables,
  type NetworkEnumName,
  type NetworkTableName,
  type SharedEnumName,
  type SharedTableName,
  sqlTableLayoutFromEnv,
} from "../src/sql-tables.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const sourcePaths = ["packages/database/src", "apps/core/src/helpers"];
const raw = new Set(["$queryRaw", "$executeRaw"]);
const unsafe = new Set(["$queryRawUnsafe", "$executeRawUnsafe"]);

// Keyed by repository path and SHA-256 of the TypeScript template. Moving
// lines does not affect a waiver. Changing or removing the template does.
const exceptions = new Map([
  [
    "apps/core/src/helpers/history.ts:65c9474cb59f536d76fb2170cf6482c5c31e61b6045f236c0c284873eb11ef06",
    {
      code: "42883",
      message: "function compute_history_job_status(text) does not exist",
      reason: "compute_history_job_status moved to shared (ticket 19)",
    },
  ],
]);

const layout = sqlTableLayoutFromEnv(process.env);
const tables = createSqlTables(layout);

function memberName(expression: ts.Expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
}

function renderName(expression: ts.Expression, isUnsafe: boolean) {
  if (isUnsafe) {
    if (
      !ts.isPropertyAccessExpression(expression) ||
      expression.name.text !== "sql"
    ) {
      return;
    }
    expression = expression.expression;
  }
  if (!ts.isCallExpression(expression)) return;
  const [first, second] = expression.arguments;
  if (!first || !ts.isStringLiteralLike(first)) return;
  const name = memberName(expression.expression);
  switch (name) {
    case "sharedTable":
      return tables.sharedTable(first.text as SharedTableName).sql;
    case "sharedType":
      return tables.sharedType(first.text as SharedEnumName).sql;
    case "netTable":
    case "netType": {
      const network = first.text;
      if (
        (network !== "mainnet" && network !== "preprod") ||
        !second ||
        !ts.isStringLiteralLike(second)
      ) {
        return;
      }
      return name === "netTable"
        ? tables.netTable(network, second.text as NetworkTableName).sql
        : tables.netType(network, second.text as NetworkEnumName).sql;
    }
  }
}

function isBoundValue(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (type.isUnion())
    return type.types.every((part: ts.Type) => isBoundValue(part, checker));
  if (
    type.flags &
    (ts.TypeFlags.StringLike |
      ts.TypeFlags.NumberLike |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.Null |
      ts.TypeFlags.Undefined)
  )
    return true;
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    return checker
      .getTypeArguments(type as ts.TypeReference)
      .every((part: ts.Type) => isBoundValue(part, checker));
  }
  return ["Date", "Decimal", "Buffer", "Uint8Array"].includes(
    type.symbol?.name ?? "",
  );
}

type Candidate = {
  node: ts.Node;
  template: ts.Expression | undefined;
  kind: "raw" | "unsafe" | "sql";
};

function findCandidates(source: ts.SourceFile) {
  const candidates: Candidate[] = [];
  function visit(node: ts.Node) {
    if (ts.isTaggedTemplateExpression(node)) {
      const name = memberName(node.tag) ?? "";
      if (raw.has(name) || name === "sql") {
        candidates.push({
          node,
          template: node.template,
          kind: name === "sql" ? "sql" : "raw",
        });
      }
    }
    if (ts.isCallExpression(node)) {
      const name = memberName(node.expression) ?? "";
      const [argument] = node.arguments;
      if (
        unsafe.has(name) ||
        (raw.has(name) &&
          (!argument || !ts.isTaggedTemplateExpression(argument)))
      ) {
        candidates.push({
          node,
          template: argument,
          kind: unsafe.has(name) ? "unsafe" : "raw",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return candidates;
}

function renderStatement(
  { node, template, kind }: Candidate,
  checker: ts.TypeChecker,
) {
  if (
    !template ||
    (!ts.isTemplateLiteral(template) && !ts.isStringLiteral(template))
  )
    return;
  let sql = ts.isTemplateExpression(template)
    ? template.head.text
    : template.text;
  // Prisma.sql is also used for clauses and expressions. A template nested
  // in a SQL interpolation supplies part of the surrounding statement.
  const command =
    sql
      .replace(/^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/|\()+/, "")
      .match(/^[A-Za-z]+/)?.[0]
      .toUpperCase() ?? "";
  if (kind === "sql") {
    if (
      ![
        "SELECT",
        "WITH",
        "VALUES",
        "TABLE",
        "INSERT",
        "UPDATE",
        "DELETE",
        "MERGE",
      ].includes(command)
    )
      return;
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isTemplateSpan(parent)) return;
    }
  }
  if (["SAVEPOINT", "RELEASE", "ROLLBACK"].includes(command)) return;
  if (!ts.isTemplateExpression(template)) return sql;
  let parameter = 0;
  for (const { expression, literal } of template.templateSpans) {
    const name = renderName(expression, kind === "unsafe");
    if (name !== undefined) {
      sql += name;
    } else if (
      kind !== "unsafe" &&
      isBoundValue(checker.getTypeAtLocation(expression), checker)
    ) {
      // PostgreSQL infers each bound value's type from its SQL context.
      sql += `$${++parameter}`;
    } else {
      return;
    }
    sql += literal.text;
  }
  return sql;
}

const configPath = join(repo, "apps/core/tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
  );
const { options, errors } = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  dirname(configPath),
);
if (errors.length)
  throw new Error(
    errors
      .map((error: ts.Diagnostic) =>
        ts.flattenDiagnosticMessageText(error.messageText, "\n"),
      )
      .join("\n"),
  );
const filesByPath = sourcePaths.map((path) =>
  globSync(`${path}/**/*.{ts,tsx,mts,cts}`, {
    cwd: repo,
    exclude: [
      "**/generated/**",
      "**/__tests__/**",
      "**/*.test.{ts,tsx,mts,cts}",
      "**/*.spec.{ts,tsx,mts,cts}",
      "**/*.d.{ts,mts,cts}",
    ],
  }).sort(),
);
// Parse every file in scope, but resolve types only from files with raw SQL.
const sqlFiles = new Set(
  filesByPath.flat().filter((file) => {
    const filename = join(repo, file);
    const text = ts.sys.readFile(filename);
    if (text === undefined) throw new Error(`Could not read ${file}`);
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest);
    return findCandidates(source).length > 0;
  }),
);
const program = ts.createProgram(
  [...sqlFiles].map((file) => join(repo, file)),
  options,
);
const checker = program.getTypeChecker();

const url = new URL(process.env.DATABASE_URL ?? "");
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.search
) {
  throw new Error(
    "DATABASE_URL must name a disposable local PostgreSQL database",
  );
}
if ([layout.shared, layout.mainnet, layout.preprod].includes("public")) {
  throw new Error(
    "Set DATABASE_SCHEMA_SHARED, DATABASE_SCHEMA_MAINNET and DATABASE_SCHEMA_PREPROD to the split schema names",
  );
}
const client = new Client({
  connectionString: url.href,
  options: "-c search_path=public -c default_transaction_read_only=on",
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
});

await client.connect();
try {
  const { rows: schemas } = await client.query(
    "SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])",
    [[layout.shared, layout.mainnet, layout.preprod]],
  );
  if (schemas.length !== 3)
    throw new Error("The configured split schemas are missing");
  let sequence = 0;
  for (const [index, path] of sourcePaths.entries()) {
    const files = filesByPath[index];
    if (files.length === 0)
      throw new Error(`No production TypeScript in ${path}`);
    const counts = { prepared: 0, excepted: 0, skipped: 0, failed: 0 };
    for (const file of files) {
      if (!sqlFiles.has(file)) continue;
      const source = program.getSourceFile(join(repo, file));
      if (!source) throw new Error(`Missing TypeScript source ${file}`);
      for (const candidate of findCandidates(source)) {
        const { line } = source.getLineAndCharacterOfPosition(
          candidate.node.getStart(source),
        );
        const location = `${file}:${line + 1}`;
        try {
          const sql = renderStatement(candidate, checker);
          if (sql === undefined) {
            counts.skipped++;
            continue;
          }
          const fingerprint = createHash("sha256")
            .update(candidate.template?.getText(source) ?? "")
            .digest("hex");
          const key = `${file}:${fingerprint}`;
          const exception = exceptions.get(key);
          exceptions.delete(key);
          const id = ++sequence;
          try {
            // A named pg query uses the extended protocol, which rejects
            // multiple commands. Both prepared statements expire at disconnect.
            await client.query({
              name: `check_${id}`,
              text: `PREPARE raw_sql_${id} AS ${sql}`,
            });
          } catch (error) {
            if (!(error instanceof Error) || !("code" in error)) throw error;
            if (
              exception &&
              error.code === exception.code &&
              error.message === exception.message
            ) {
              console.log(`${location} excepted: ${exception.reason}`);
              counts.excepted++;
              continue;
            }
            // A parenthesized Prisma.sql subquery can refer to an outer alias.
            // PostgreSQL reports a missing relation with a different message.
            if (
              !exception &&
              candidate.kind === "sql" &&
              sql.trimStart().startsWith("(") &&
              error.code === "42P01" &&
              error.message.startsWith("missing FROM-clause entry for table ")
            ) {
              counts.skipped++;
              continue;
            }
            throw error;
          }
          if (exception)
            throw new Error(
              `Stale exception: ${exception.reason}. Remove ${key}.`,
            );
          counts.prepared++;
        } catch (error) {
          console.error(
            `${location} ${error instanceof Error ? error.message : error}`,
          );
          counts.failed++;
        }
      }
    }
    console.log(
      `${path}: ${files.length} files, ${counts.prepared} prepared, ${counts.excepted} excepted, ${counts.skipped} not preparable, ${counts.failed} failed`,
    );
    if (counts.failed) process.exitCode = 1;
  }
  for (const [key, { reason }] of exceptions) {
    console.error(
      `Stale exception: ${key} no longer matches a preparable statement (${reason})`,
    );
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
