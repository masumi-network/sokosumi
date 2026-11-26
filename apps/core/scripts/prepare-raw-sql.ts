// Test only. Run after split-network-layout.sh on a disposable PostgreSQL
// database. PREPARE analyzes statements without executing them.
import { createHash } from "node:crypto";
import { globSync } from "node:fs";
import { relative, resolve } from "node:path";

import {
  createSqlTables,
  type NetworkEnumName,
  type NetworkTableName,
  type SharedEnumName,
  type SharedTableName,
  sqlTableLayoutFromEnv,
} from "@sokosumi/database/sql-tables";
import ts from "@typescript/typescript6";
import { Client } from "pg";

import {
  bareNames,
  type SqlText,
  sqlTexts,
} from "../src/test/raw-sql-bare-names";

const ROOT = resolve(import.meta.dirname, "../../..");
const SOURCE_PATHS = [
  "packages/database/src",
  "apps/core/src/helpers",
  "apps/core/src/routes/v1",
  "apps/core/src/services",
  "apps/core/src/lib",
  "apps/core/src/types",
  "apps/core/scripts",
];
const RAW = new Set(["$queryRaw", "$executeRaw"]);
const UNSAFE = new Set(["$queryRawUnsafe", "$executeRawUnsafe"]);
const PREPARABLE = new Set(
  "SELECT INSERT UPDATE DELETE MERGE VALUES WITH".split(" "),
);

// Keyed by repository path and SHA-256 of the TypeScript template. Moving
// lines does not affect a waiver. Changing or removing the template does.
// A false finding of the bare name check (`src/test/raw-sql-bare-names.ts`)
// has the code "bare name" and the finding's text as its message.
const EXCEPTIONS = new Map([
  [
    "apps/core/src/helpers/history.ts:65c9474cb59f536d76fb2170cf6482c5c31e61b6045f236c0c284873eb11ef06",
    {
      line: 254,
      code: "42883",
      message: "function compute_history_job_status(text) does not exist",
      reason: "compute_history_job_status moved to shared (ticket 19)",
    },
  ],
]);

const TABLES = createSqlTables({
  ...sqlTableLayoutFromEnv(process.env),
  preprodOn: true,
});

function memberName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : "";
}

function renderName(expression: ts.Expression, unsafe: boolean) {
  if (unsafe) {
    if (
      !ts.isPropertyAccessExpression(expression) ||
      expression.name.text !== "sql"
    )
      return;
    expression = expression.expression;
  }
  if (!ts.isCallExpression(expression)) return;
  const helper = memberName(expression.expression);
  const [network, name] = expression.arguments;
  const explicitNetwork = helper === "netTable" || helper === "netType";
  const literal = explicitNetwork ? name : network;
  if (!literal || !ts.isStringLiteralLike(literal)) return;
  const preprod =
    network && ts.isStringLiteralLike(network) && network.text === "preprod";
  const tableNetwork = explicitNetwork && preprod ? "preprod" : "mainnet";
  switch (helper) {
    case "sharedTable":
      return TABLES.sharedTable(literal.text as SharedTableName).sql;
    case "sharedType":
      return TABLES.sharedType(literal.text as SharedEnumName).sql;
    case "netTable":
    case "networkTable":
      return TABLES.netTable(tableNetwork, literal.text as NetworkTableName)
        .sql;
    case "netType":
      return TABLES.netType(tableNetwork, literal.text as NetworkEnumName).sql;
  }
}

function hasAny(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (type.flags & ts.TypeFlags.Any) return true;
  if (type.isUnion())
    return type.types.some((part: ts.Type) => hasAny(part, checker));
  return (
    (checker.isArrayType(type) || checker.isTupleType(type)) &&
    checker
      .getTypeArguments(type as ts.TypeReference)
      .some((part: ts.Type) => hasAny(part, checker))
  );
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

interface Candidate {
  node: ts.Node;
  template?: ts.Expression;
  unsafe: boolean;
}

function unparenthesize(expression?: ts.Expression) {
  while (expression && ts.isParenthesizedExpression(expression))
    expression = expression.expression;
  return expression;
}

function findStatements(source: ts.SourceFile, checker: ts.TypeChecker) {
  const statements: Candidate[] = [];
  const fragments = new Set<ts.TemplateLiteral>();
  const usedTemplates = new Set<ts.TemplateLiteral>();
  function visit(node: ts.Node) {
    ts.forEachChild(node, visit);
    if (ts.isTaggedTemplateExpression(node)) {
      const name = memberName(node.tag);
      if (name === "sql") fragments.add(node.template);
      if (RAW.has(name))
        statements.push({ node, template: node.template, unsafe: false });
      return;
    }
    if (!ts.isCallExpression(node)) return;
    const name = memberName(node.expression);
    const unsafe = UNSAFE.has(name);
    if (!unsafe && !RAW.has(name)) return;
    let expression = unparenthesize(node.arguments[0]);
    if (!unsafe && expression && ts.isIdentifier(expression)) {
      const declaration =
        checker.getSymbolAtLocation(expression)?.valueDeclaration;
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.parent.flags & ts.NodeFlags.Const
      ) {
        expression = unparenthesize(declaration.initializer);
      }
    }
    if (
      !unsafe &&
      expression &&
      ts.isTaggedTemplateExpression(expression) &&
      memberName(expression.tag) === "sql"
    ) {
      usedTemplates.add(expression.template);
      expression = expression.template;
    }
    statements.push({ node, template: expression, unsafe });
  }
  visit(source);
  return {
    statements,
    templates: fragments,
    fragments: fragments.difference(usedTemplates).size,
  };
}

function canPrepare(sql: string) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    undefined,
    sql,
  );
  while (true) {
    const token = scanner.scan();
    if (token === ts.SyntaxKind.EndOfFileToken) return false;
    if (token === ts.SyntaxKind.OpenParenToken) continue;
    if (token !== ts.SyntaxKind.MinusMinusToken)
      return PREPARABLE.has(scanner.getTokenText().toUpperCase());
    const end = sql.indexOf("\n", scanner.getTokenEnd());
    if (end < 0) return false;
    scanner.setTextPos(end + 1);
  }
}

function render(
  { template, unsafe }: Candidate,
  checker: ts.TypeChecker,
): string[] | "assembled" | "command" {
  if (
    !template ||
    (!ts.isTemplateLiteral(template) && !ts.isStringLiteral(template))
  )
    return "assembled";
  const head = ts.isTemplateExpression(template)
    ? template.head.text
    : template.text;
  let variants = [
    { sql: head, choices: new Map<ts.Symbol | ts.Expression, string>() },
  ];
  if (!ts.isTemplateExpression(template))
    return canPrepare(head) ? [head] : "command";
  let assembled = false;
  let parameter = 0;
  for (const { expression, literal } of template.templateSpans) {
    const type = checker.getTypeAtLocation(expression);
    if (hasAny(type, checker)) {
      const verb = type.flags & ts.TypeFlags.Any ? "has" : "contains";
      throw new Error(
        `Unresolved SQL hole ${expression.getText()} ${verb} type any`,
      );
    }
    const name = renderName(expression, unsafe);
    if (name !== undefined || (!unsafe && isBoundValue(type, checker))) {
      const value = name ?? `$${++parameter}`;
      for (const variant of variants) variant.sql += value + literal.text;
      continue;
    }
    const members: ts.Type[] = type.isUnion() ? type.types : [type];
    if (unsafe && members.every((member) => member.isStringLiteral())) {
      const symbol =
        ts.isIdentifier(expression) && checker.getSymbolAtLocation(expression);
      const key = symbol || expression;
      variants = variants.flatMap(({ sql, choices }) => {
        const selected = choices.get(key);
        return (
          selected === undefined
            ? members.map((member) => member.value)
            : [selected]
        ).map((value) => ({
          sql: sql + value + literal.text,
          choices: new Map(choices).set(key, value),
        }));
      });
    } else {
      assembled = true;
    }
  }
  if (assembled) return "assembled";
  return variants.every(({ sql }) => canPrepare(sql))
    ? variants.map(({ sql }) => sql)
    : "command";
}

function reportFailure(location: string, key: string, error: unknown) {
  const code =
    error instanceof Error && "code" in error ? error.code : "no SQLSTATE";
  console.error(
    `${location} [${code}] ${error instanceof Error ? error.message : error}\nException key: ${key}\nQualify the name with sharedTable, netTable, sharedType, or netType from @sokosumi/database/sql-tables. See apps/core/AGENTS.md#raw-sql.\nIf applicable, cast the parameter or add a ticketed entry to EXCEPTIONS in apps/core/scripts/prepare-raw-sql.ts.`,
  );
  process.exitCode = 1;
}

const config = ts.readConfigFile(
  resolve(ROOT, "apps/core/tsconfig.json"),
  ts.sys.readFile,
);
if (config.error) throw new Error("Could not read apps/core/tsconfig.json");
const { options, errors } = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  resolve(ROOT, "apps/core"),
);
if (errors.length) throw new Error("Invalid Core TypeScript config");
const groups = SOURCE_PATHS.map((path) => ({
  path,
  files: globSync(`${path}/**/*.{ts,tsx,mts,cts}`, {
    cwd: ROOT,
    exclude: [
      "**/generated/**",
      "**/__tests__/**",
      "**/*.{test,spec,d}.{ts,tsx,mts,cts}",
    ],
  }).sort(),
}));
const roots = groups.flatMap(({ files }) =>
  files.map((file) => resolve(ROOT, file)),
);
const program = ts.createProgram(roots, options);
const checker = program.getTypeChecker();

const url = new URL(process.env.DATABASE_URL ?? "");
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.search
)
  throw new Error("Expected a disposable local PostgreSQL DATABASE_URL");
const client = new Client({
  connectionString: url.href,
  options: "-c search_path=public -c default_transaction_read_only=on",
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
});
await client.connect();
try {
  let sequence = 0;
  // What PREPARE never sees: every `Prisma.sql` template, every statement it
  // skips, and the string pieces a skipped `*RawUnsafe` statement names.
  const unprepared = new Set<SqlText>();
  for (const { path, files } of groups) {
    if (!files.length) throw new Error(`No production TypeScript in ${path}`);
    const counts = {
      prepared: 0,
      excepted: 0,
      command: 0,
      assembled: 0,
      failed: 0,
    };
    let fragmentCount = 0;
    for (const file of files) {
      const source = program.getSourceFile(resolve(ROOT, file));
      if (!source) throw new Error(`Could not parse ${file}`);
      const { statements, templates, fragments } = findStatements(
        source,
        checker,
      );
      fragmentCount += fragments;
      for (const template of templates) unprepared.add(template);
      for (const candidate of statements) {
        const { line } = source.getLineAndCharacterOfPosition(
          candidate.node.getStart(source),
        );
        const location = `${file}:${line + 1}`;
        const hash = createHash("sha256")
          .update((candidate.template ?? candidate.node).getText())
          .digest("hex");
        const key = `${file}:${hash}`;
        try {
          const variants = render(candidate, checker);
          if (typeof variants === "string") {
            counts[variants]++;
            console.log(`${location} not preparable (${variants})`);
            for (const text of sqlTexts(
              candidate.template ?? candidate.node,
              candidate.unsafe ? checker : undefined,
            ))
              unprepared.add(text);
            continue;
          }
          const exception = EXCEPTIONS.get(key);
          EXCEPTIONS.delete(key);
          for (const sql of variants) {
            // A named pg query uses the extended protocol, which rejects
            // multiple commands. Both prepared statements expire at disconnect.
            const error: unknown = await client
              .query({
                name: `check_${++sequence}`,
                text: `PREPARE raw_sql_${sequence} AS ${sql}`,
              })
              .then(
                () => undefined,
                (error: unknown) => error,
              );
            if (
              exception &&
              error instanceof Error &&
              "code" in error &&
              error.code === exception.code &&
              error.message === exception.message
            )
              continue;
            if (error) throw error;
            if (exception)
              throw new Error("Stale exception. Remove this entry.");
          }
          if (exception) {
            console.log(`${location} excepted: ${exception.reason}`);
            counts.excepted++;
          } else counts.prepared++;
        } catch (error) {
          counts.failed++;
          reportFailure(location, key, error);
        }
      }
    }
    const { prepared, excepted, command, assembled, failed } = counts;
    const statementCount = prepared + excepted + command + assembled + failed;
    console.log(
      `${path}: ${files.length} files, ${statementCount} statements (${prepared} prepared, ${excepted} excepted, ${command} commands, ${assembled} assembled, ${failed} failed), ${fragmentCount} fragments`,
    );
  }
  let bare = 0;
  for (const text of unprepared) {
    const found = bareNames(text);
    if (!found.length) continue;
    const file = relative(ROOT, text.getSourceFile().fileName);
    const hash = createHash("sha256").update(text.getText()).digest("hex");
    const key = `${file}:${hash}`;
    const message = found.map(({ name }) => name).join(", ");
    const exception = EXCEPTIONS.get(key);
    if (exception?.code === "bare name" && exception.message === message) {
      EXCEPTIONS.delete(key);
      console.log(`${file}:${found[0]?.line} excepted: ${exception.reason}`);
      continue;
    }
    bare += found.length;
    for (const { line, name } of found)
      reportFailure(
        `${file}:${line}`,
        key,
        Object.assign(new Error(name), { code: "bare name" }),
      );
  }
  console.log(
    `Not prepared: ${unprepared.size} fragments, skipped statements and their string pieces, ${bare} bare names`,
  );
  for (const [key, { line, reason }] of EXCEPTIONS) {
    reportFailure(
      `${key.split(":")[0]}:${line}`,
      key,
      `Stale exception: no preparable statement or bare name matches (${reason}). Remove this entry.`,
    );
  }
} finally {
  await client.end();
}
