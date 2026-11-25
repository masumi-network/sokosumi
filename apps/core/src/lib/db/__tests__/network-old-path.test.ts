import { globSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "@sokosumi/database/client";
import ts from "@typescript/typescript6";
import { beforeAll, expect, it } from "vitest";

// Each allowlist tracks files, so moving the last finding removes one line.
//
// Known gaps: this is a lexical scan. It does not follow re-exports, dynamic
// imports or keys, mutable aliases, delegates held separately, client
// factories or extensions, named transaction callbacks, imported or generic
// client type aliases, or clients passed in an object. A PrismaClient
// annotation alone does not identify the default client.
// Relations use locally known clients and fragments. Imported or returned
// untyped fragments, conditional spread contents, unknown overriding keys,
// _count, orderBy and nested writes are outside the scan; so are inferred
// Hono scopes and destructured handles without a client annotation.
// Pick and Omit are checked where they are written with the imported
// NetworkDb; indexed access and aliases of the operand are outside the rule.
// Ticket 60 covers scope handles used inside its transaction callbacks.
const ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));
const CORE_SRC = resolve(ROOT, "apps/core/src");
const networkTables = JSON.parse(
  readFileSync(
    resolve(ROOT, "packages/database/prisma/network-tables.json"),
    "utf8",
  ),
) as { network: Record<string, string>; shared: Record<string, string> };
const networkModels = new Set(Object.keys(networkTables.network));
const modelsByDelegate = new Map(
  [...networkModels, ...Object.keys(networkTables.shared)].map((model) => [
    model.charAt(0).toLowerCase() + model.slice(1),
    model,
  ]),
);

// Prisma exposes this runtime metadata without a public type.
// Constructing the client does not open a connection.
const { models } = (
  createPrismaClient("postgresql://127.0.0.1:1/none") as unknown as {
    _runtimeDataModel: {
      models: Record<
        string,
        { fields: { name: string; kind: string; type: string }[] }
      >;
    };
  }
)._runtimeDataModel;

type MemberAccess = ts.PropertyAccessExpression | ts.ElementAccessExpression;

function isMemberAccess(node: ts.Node): node is MemberAccess {
  return (
    ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
  );
}

function stringValue(node: ts.Node): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
}

function memberName(node: MemberAccess): string | undefined {
  return ts.isPropertyAccessExpression(node)
    ? node.name.text
    : stringValue(node.argumentExpression);
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function importsFrom(
  declaration: ts.ImportDeclaration | ts.JSDocImportTag,
  module: string,
): boolean {
  if (!ts.isImportDeclaration(declaration)) return false;
  const specifier = declaration.moduleSpecifier;
  if (!ts.isStringLiteral(specifier)) return false;
  if (module.startsWith("@sokosumi/")) return specifier.text === module;
  const path = specifier.text.startsWith("@/")
    ? resolve(CORE_SRC, specifier.text.slice(2))
    : resolve(dirname(declaration.getSourceFile().fileName), specifier.text);
  const target = resolve(CORE_SRC, module);
  return path === target || path === `${target}.js` || path === `${target}.ts`;
}

type RelationContext =
  | "args"
  | "include"
  | "select"
  | "where"
  | "relation filter";
type ReportRelation = (node: ts.Node, reason: string) => void;
const relationTypes = new Map<
  string,
  { model: string; context: RelationContext }
>();
const relationTypeContexts = {
  Include: "include",
  Select: "select",
  WhereInput: "where",
  WhereUniqueInput: "where",
} as const;
for (const model of modelsByDelegate.values()) {
  for (const [suffix, context] of Object.entries(relationTypeContexts)) {
    relationTypes.set(`${model}${suffix}`, { model, context });
  }
}

const logicalFilters = new Set(["AND", "OR", "NOT"]);
const relationFilters = new Set(["is", "isNot", "some", "none", "every"]);

function assertAllowlist(
  label: string,
  allowlist: string,
  findings: Map<string, string[]>,
  message: string,
): void {
  const allowed = readFileSync(new URL(allowlist, import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean);
  const unique = new Set(allowed);
  console.log(`Network old path, ${label}: ${findings.size} files`);
  expect(
    {
      new: [...findings]
        .filter(([file]) => !unique.has(file))
        .flatMap(([, locations]) => locations),
      stale: [...unique].filter((file) => !findings.has(file)),
      duplicateLines: allowed.length - unique.size,
    },
    message,
  ).toEqual({ new: [], stale: [], duplicateLines: 0 });
}

// Use TypeScript's lexical bindings without loading imports or checking types.
function scanSources(sources: ReadonlyMap<string, string>) {
  const options: ts.CompilerOptions = {
    noResolve: true,
    noLib: true,
    types: [],
    allowJs: true,
  };
  const program = ts.createProgram([...sources.keys()], options, {
    ...ts.createCompilerHost(options),
    getSourceFile(file, target) {
      const text = sources.get(file);
      if (text !== undefined)
        return ts.createSourceFile(file, text, target, true);
    },
    fileExists: (file) => sources.has(file),
    readFile: (file) => sources.get(file),
    resolveModuleNameLiterals: (names) =>
      names.map(() => ({ resolvedModule: undefined })),
  });
  const bindings = program.getTypeChecker();
  const prismaModule = "lib/db/prisma";
  const scopeModule = "lib/db/network-scope";

  function declarationOf(node: ts.Node): ts.Declaration | undefined {
    return bindings.getSymbolAtLocation(node)?.declarations?.[0];
  }

  function constInitializer(
    declaration: ts.Declaration | undefined,
    reference: ts.Identifier,
  ): ts.Expression | undefined {
    if (!declaration || !ts.isVariableDeclaration(declaration)) return;
    const list = declaration.parent;
    if (
      ts.isVariableDeclarationList(list) &&
      list.flags & ts.NodeFlags.Const &&
      declaration.end < reference.pos
    )
      return declaration.initializer;
  }

  function importedName(
    node: ts.Node,
    module: string,
    typePosition = false,
  ): string | undefined {
    const declaration = declarationOf(node);
    if (!declaration) return;

    const named = ts.isImportSpecifier(declaration) ? declaration : undefined;
    const clause =
      named?.parent.parent ??
      (ts.isImportClause(declaration) ? declaration : undefined);
    if (!clause || !importsFrom(clause.parent, module)) return;
    if (!typePosition && (clause.isTypeOnly || named?.isTypeOnly)) return;
    return named ? (named.propertyName ?? named.name).text : "default";
  }

  function isDefaultClient(
    expression: ts.Expression,
    typePosition = false,
  ): boolean {
    const value = resolveLocal(expression);
    if (ts.isIdentifier(value)) {
      return importedName(value, prismaModule, typePosition) === "default";
    }
    if (!isMemberAccess(value) || memberName(value) !== "default") return false;
    const declaration = declarationOf(value.expression);
    return (
      !!declaration &&
      ts.isNamespaceImport(declaration) &&
      (typePosition || !declaration.parent.isTypeOnly) &&
      importsFrom(declaration.parent.parent, prismaModule)
    );
  }

  function prismaType(name: ts.EntityName): string | undefined {
    if (
      ts.isQualifiedName(name) &&
      ts.isIdentifier(name.left) &&
      (importedName(name.left, "@sokosumi/database", true) === "Prisma" ||
        importedName(name.left, "@sokosumi/database/client", true) ===
          "PrismaRaw")
    ) {
      return name.right.text;
    }
  }

  function callbackTransaction(callback: ts.Node): boolean {
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
      return false;
    const call = callback.parent;
    if (!ts.isCallExpression(call) || call.arguments[0] !== callback)
      return false;
    const method = unwrap(call.expression);
    if (ts.isIdentifier(method)) {
      const helper = importedName(method, "lib/db/transaction");
      return (
        helper === "serializableTransaction" || helper === "retriedTransaction"
      );
    }
    return (
      isMemberAccess(method) &&
      memberName(method) === "$transaction" &&
      isDefaultClient(method.expression)
    );
  }

  function utilityTarget(
    type: ts.TypeNode | undefined,
    name: string,
  ): ts.TypeNode | undefined {
    if (
      type &&
      ts.isTypeReferenceNode(type) &&
      ts.isIdentifier(type.typeName) &&
      type.typeName.text === name &&
      !declarationOf(type.typeName)
    )
      return type.typeArguments?.[0];
  }

  function isLegacyType(
    type: ts.TypeNode | undefined,
    seen?: ReadonlySet<ts.TypeAliasDeclaration>,
  ): boolean {
    if (!type) return false;
    if (ts.isUnionTypeNode(type))
      return type.types.every((part) => isLegacyType(part, seen));
    const queried = utilityTarget(type, "Pick") ?? type;
    if (ts.isTypeQueryNode(queried)) {
      return (
        ts.isIdentifier(queried.exprName) &&
        isDefaultClient(queried.exprName, true)
      );
    }
    if (!ts.isTypeReferenceNode(queried)) return false;
    const alias = declarationOf(queried.typeName);
    if (
      alias &&
      ts.isTypeAliasDeclaration(alias) &&
      !alias.typeParameters &&
      alias.getSourceFile() === queried.getSourceFile() &&
      !seen?.has(alias)
    ) {
      return isLegacyType(alias.type, new Set(seen).add(alias));
    }
    return (
      prismaType(queried.typeName) === "TransactionClient" ||
      namedType(queried, prismaModule) === "DbClient"
    );
  }

  function namedType(
    type: ts.TypeNode | undefined,
    module: string,
  ): string | undefined {
    if (
      type &&
      ts.isTypeReferenceNode(type) &&
      ts.isIdentifier(type.typeName)
    ) {
      return importedName(type.typeName, module, true);
    }
  }

  function clientDeclaration(expression: ts.Identifier) {
    const node = declarationOf(expression);
    if (node && (ts.isParameter(node) || ts.isVariableDeclaration(node)))
      return node;
  }

  function isScope(expression: ts.Expression): boolean {
    const value = unwrap(expression);
    if (
      ts.isIdentifier(value) &&
      namedType(clientDeclaration(value)?.type, scopeModule) === "NetworkScope"
    )
      return true;
    const resolved = resolveLocal(value);
    return (
      ts.isCallExpression(resolved) &&
      importedName(resolved.expression, scopeModule) === "createNetworkScope"
    );
  }

  function clientKind(
    expression: ts.Expression,
  ): "legacy" | "scope" | undefined {
    expression = unwrap(expression);
    const value = resolveLocal(expression);
    if (isDefaultClient(value)) return "legacy";
    if (isMemberAccess(value)) {
      const name = memberName(value);
      if (
        (name === "networkDb" || name === "sharedDb") &&
        isScope(value.expression)
      )
        return "scope";
    }
    if (!ts.isIdentifier(expression)) return;
    const declaration = clientDeclaration(expression);
    if (!declaration) return;
    const side = namedType(declaration.type, scopeModule);
    if (side === "NetworkDb" || side === "SharedDb") return "scope";
    if (isLegacyType(declaration.type)) return "legacy";
    if (
      ts.isParameter(declaration) &&
      ((declaration.initializer && isDefaultClient(declaration.initializer)) ||
        (declaration.parent.parameters[0] === declaration &&
          callbackTransaction(declaration.parent)))
    ) {
      return "legacy";
    }
    const initializer = constInitializer(declaration, expression);
    return initializer ? clientKind(initializer) : undefined;
  }

  function resolveLocal(expression: ts.Expression): ts.Expression {
    expression = unwrap(expression);
    if (!ts.isIdentifier(expression)) return expression;
    const declaration = ts.isShorthandPropertyAssignment(expression.parent)
      ? bindings.getShorthandAssignmentValueSymbol(expression.parent)
          ?.valueDeclaration
      : declarationOf(expression);
    const initializer = constInitializer(declaration, expression);
    return initializer ? resolveLocal(initializer) : expression;
  }

  function knownProperties(
    literal: ts.ObjectLiteralExpression,
    fields = new Map<
      string,
      ts.PropertyAssignment | ts.ShorthandPropertyAssignment
    >(),
  ) {
    for (const property of literal.properties) {
      if (
        ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property)
      ) {
        const key = property.name;
        const name = ts.isComputedPropertyName(key)
          ? stringValue(unwrap(key.expression))
          : ts.isIdentifier(key)
            ? key.text
            : stringValue(key);
        if (name !== undefined) {
          fields.set(name, property);
          continue;
        }
      }
      if (ts.isSpreadAssignment(property)) {
        const spread = resolveLocal(property.expression);
        if (ts.isObjectLiteralExpression(spread)) {
          knownProperties(spread, fields);
          continue;
        }
        if (
          ts.isConditionalExpression(spread) ||
          (ts.isBinaryExpression(spread) &&
            spread.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
        )
          continue;
      }
      // An unknown key or spread may override any earlier field.
      fields.clear();
    }
    return fields;
  }

  function walkRelations(
    expression: ts.Expression,
    model: string,
    context: RelationContext,
    report: ReportRelation,
  ): void {
    const literal = resolveLocal(expression);
    if (context === "where" && ts.isArrayLiteralExpression(literal)) {
      for (const element of literal.elements)
        walkRelations(element, model, context, report);
      return;
    }
    if (!ts.isObjectLiteralExpression(literal)) return;

    for (const [name, property] of knownProperties(literal)) {
      const child = ts.isPropertyAssignment(property)
        ? property.initializer
        : property.name;

      if (context === "args") {
        if (name === "include" || name === "select" || name === "where") {
          walkRelations(child, model, name, report);
        }
        continue;
      }

      const filtering = context === "where" || context === "relation filter";
      if (
        filtering &&
        (logicalFilters.has(name) ||
          (context === "relation filter" && relationFilters.has(name)))
      ) {
        walkRelations(child, model, "where", report);
        continue;
      }
      const related = models[model]?.fields.find(
        (field) => field.kind === "object" && field.name === name,
      )?.type;
      if (!related) continue;
      const resolved = resolveLocal(child);
      if (
        resolved.kind === ts.SyntaxKind.FalseKeyword ||
        (ts.isIdentifier(resolved) &&
          resolved.text === "undefined" &&
          !declarationOf(resolved))
      )
        continue;

      if (networkModels.has(model) !== networkModels.has(related)) {
        report(
          property.name,
          `${model}.${name} → ${related} (${filtering ? "where" : context})`,
        );
      }
      walkRelations(
        child,
        related,
        filtering ? "relation filter" : "args",
        report,
      );
    }
  }

  function typedRelation(node: ts.Node, report: ReportRelation): void {
    let type: ts.TypeNode | undefined;
    let value: ts.Expression | undefined;
    if (ts.isVariableDeclaration(node) || ts.isSatisfiesExpression(node)) {
      type = node.type;
      value = ts.isVariableDeclaration(node)
        ? node.initializer
        : node.expression;
    } else if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      type = node.type;
      value = node.body;
    } else if (ts.isReturnStatement(node)) {
      let parent = node.parent;
      while (!ts.isFunctionLike(parent) && !ts.isSourceFile(parent))
        parent = parent.parent;
      if (!ts.isFunctionLike(parent)) return;
      ({ type } = parent);
      value = node.expression;
    }
    if (!value || !type || !ts.isTypeReferenceNode(type)) return;
    const relation = relationTypes.get(prismaType(type.typeName) ?? "");
    if (relation)
      walkRelations(value, relation.model, relation.context, report);
  }

  const legacyCalls = new Map<string, string[]>();
  const relations = new Map<string, string[]>();
  const unbrandedTypes: string[] = [];

  for (const source of program.getSourceFiles()) {
    const calls: string[] = [];
    const crossings = new Set<string>();
    const file = relative(ROOT, source.fileName);
    function location(node: ts.Node): string {
      const { line } = ts.getLineAndCharacterOfPosition(
        source,
        node.getStart(source),
      );
      return `${file}:${line + 1}`;
    }
    function reportRelation(node: ts.Node, reason: string): void {
      crossings.add(`${location(node)} ${reason}`);
    }
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const operation = unwrap(node.expression);
        const delegate =
          isMemberAccess(operation) && unwrap(operation.expression);
        if (delegate && isMemberAccess(delegate)) {
          const model = modelsByDelegate.get(memberName(delegate) ?? "");
          const client = model && clientKind(delegate.expression);
          if (model && client) {
            if (client === "legacy" && networkModels.has(model))
              calls.push(location(node));
            if (node.arguments[0])
              walkRelations(node.arguments[0], model, "args", reportRelation);
          }
        }
      }
      typedRelation(node, reportRelation);
      if (ts.isTypeReferenceNode(node)) {
        const target =
          utilityTarget(node, "Pick") ?? utilityTarget(node, "Omit");
        if (namedType(target, scopeModule) === "NetworkDb") {
          unbrandedTypes.push(location(node));
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (calls.length) legacyCalls.set(file, calls);
    if (crossings.size) relations.set(file, [...crossings]);
  }
  return { legacyCalls, relations, unbrandedTypes };
}
let findings: ReturnType<typeof scanSources>;
beforeAll(() => {
  const started = performance.now();
  const files = globSync("**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}", {
    cwd: CORE_SRC,
    exclude: [
      "**/*.test.*",
      "**/*.spec.*",
      "**/__tests__/**",
      "**/__fixtures__/**",
      "test/**",
      "test-fixtures/**",
    ],
  })
    .sort()
    .map((file) => resolve(CORE_SRC, file));
  findings = scanSources(
    new Map(files.map((file) => [file, readFileSync(file, "utf8")])),
  );
  console.log(
    `Network old path scan: ${files.length} sources in ${Math.round(performance.now() - started)} ms`,
  );
});

it("keeps the legacy client Network allowlist from growing or going stale", () => {
  assertAllowlist(
    "legacy client Network calls",
    "network-default-client-allowlist.txt",
    findings.legacyCalls,
    "Use the Network scope for Network model calls. Remove the allowlist entry when its last legacy call moves.",
  );
});
it("keeps the cross-schema relation allowlist from growing or going stale", () => {
  assertAllowlist(
    "cross-schema relations",
    "network-relation-allowlist.txt",
    findings.relations,
    "Query the two schemas separately. Remove the allowlist entry when its last crossing moves.",
  );
});
it("keeps NetworkDb whole", () => {
  expect(
    findings.unbrandedTypes,
    "Use NetworkDb whole so the type retains its brand.",
  ).toEqual([]);
});

const defaultImport = 'import prisma from "@/lib/db/prisma";';
const scopeImport =
  'import type { NetworkDb, NetworkScope, SharedDb } from "@/lib/db/network-scope";';
const modelImport = 'import type { Prisma } from "@sokosumi/database";';
it.each([
  [
    "legacy clients",
    `${defaultImport}
    import db from "../lib/db/prisma.js";
    import { serializableTransaction as serial, retriedTransaction } from "@/lib/db/transaction";
    import type { DbClient } from "@/lib/db/prisma";
    ${modelImport}
    prisma.job.findMany();
    prisma.$transaction([prisma.job.findMany()]);
    prisma.$transaction(async (tx) => tx.job.findMany());
    serial((tx) => tx.creditBucket.findMany(), "conflict");
    retriedTransaction((tx) => tx.job.findMany(), "conflict");
    const a = (db = prisma) => db.job.findMany();
    const b = (db: DbClient) => db.job.findMany();
    const c = (db: Prisma.TransactionClient) => db.agent.findMany();
    const d = (db: typeof prisma) => db.job.findMany();
    const e = (db: Pick<typeof prisma, "job">) => db.job.findMany();
    const f = (db: Prisma.TransactionClient | typeof prisma) => db.job.findMany();
    db?.["job"]!.findMany();
    declare const typed: DbClient; typed.job.findMany();
    const alias = (tx: Tx) => tx.job.findMany();
    const pickedAlias = (tx: Pick<Tx, "job">) => tx.job.findMany();
    type Tx = Prisma.TransactionClient;
    const pickedTransaction = (tx: Pick<Prisma.TransactionClient, "creditBucket">) => tx.creditBucket.findMany();
    const pickedClient = (client: Pick<DbClient, "job">) => client.job.findMany();`,
    { calls: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23] },
  ],
  [
    "typed relation returns and conditional spreads",
    `${defaultImport}
    ${modelImport}
    ${scopeImport}
    prisma.task.findMany({ include: { jobs: true, ...(extra ? { project: true } : {}) } });
    const q = (scope: NetworkScope) => scope.networkDb.job.findMany({
      where: { AND: [{ workspace: { is: { id: "ws" } } }] },
    });
    function where(): Prisma.JobWhereInput { return { task: { is: { id: "1" } } }; }
    const include = (): Prisma.TaskInclude => ({ jobs: true });
    const nested = { task: { select: { id: true } } } satisfies Prisma.JobSelect;
    prisma.task.findMany({ where: { jobs: { some: {} }, ...(extra && { id: "1" }) } });
    const shared = (db: SharedDb) => db.task.findMany({ where: { jobs: { some: {} } } });
    prisma.project.findMany({ where: { tasks: { some: { jobs: { some: {} } } } } });`,
    { relations: [4, 6, 8, 9, 10, 11, 12, 13] },
  ],
  [
    "Pick and Omit references",
    `
    import type { NetworkDb as Db } from "@/lib/db/network-scope";
    type Options = { db: Pick<Db, "job"> };
    function f(db: Hoisted | null) {}
    type Hoisted = Omit<Db, "$executeRaw">;
    const g = <T extends Pick<Db, "job">>(db: T) => db;
    const h = ({ db }: { db: Pick<Db, "job"> | undefined }) => db;`,
    { types: [3, 5, 6, 7] },
  ],
  [
    "scope handles, shadowed names and same-side queries",
    `${defaultImport}
    ${scopeImport}
    function f(scope: NetworkScope, db: NetworkDb) {
      const { sharedDb } = scope;
      scope.networkDb.job.findMany({ include: { agent: true } });
      scope.sharedDb.task.findMany({ include: { project: true } });
      db.creditCost.findMany();
      prisma.task.findMany({ include: { jobs: false, project: true } });
      prisma.task.findMany({ include: { jobs: undefined } });
      return prisma.$transaction(async (tx) => {
        type Db = typeof sharedDb;
        void ({ sharedDb: "tag" }).sharedDb;
        return tx.task.findMany();
      });
    }
    function shadowed() {
      const job = { findMany: (_options) => [] };
      const prisma = { job };
      prisma.job.findMany({ include: { workspace: true } });
      const item = { tag: "mail" };
      item.tag.toLowerCase();
      type Pick<T, _K> = T;
      type Omit<T, _K> = T;
      const f = (db: Pick<NetworkDb, "job">, other: Omit<NetworkDb, "job">) => db.job.findMany();
    }`,
    {},
  ],
] as const)("%s", (_name, text, expected) => {
  const source = resolve(CORE_SRC, "routes/network-scan-probe.ts");
  const { legacyCalls, relations, unbrandedTypes } = scanSources(
    new Map([[source, text]]),
  );
  const lines = (locations: string[] = []) =>
    locations.map((location) => Number.parseInt(location.split(":")[1], 10));
  const file = relative(ROOT, source);
  expect({
    calls: lines(legacyCalls.get(file)),
    relations: lines(relations.get(file)),
    types: lines(unbrandedTypes),
  }).toEqual({ calls: [], relations: [], types: [], ...expected });
});
