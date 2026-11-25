import { globSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "@sokosumi/database/client";
import ts from "@typescript/typescript6";
import { expect, it } from "vitest";

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

interface PrismaModelMetadata {
  _runtimeDataModel: {
    models: Record<
      string,
      { fields: { name: string; kind: string; type: string }[] }
    >;
  };
}

// Use the generated client's model metadata, as network-tables.test.ts does.
// Constructing the client does not open a connection.
const modelMetadata = (
  createPrismaClient(
    "postgresql://127.0.0.1:1/none",
  ) as unknown as PrismaModelMetadata
)._runtimeDataModel.models;
const modelRelations = new Map(
  Object.entries(modelMetadata).map(([model, { fields }]) => [
    model,
    new Map(
      fields
        .filter(({ kind }) => kind === "object")
        .map(({ name, type }) => [name, type]),
    ),
  ]),
);

type MemberAccess = ts.PropertyAccessExpression | ts.ElementAccessExpression;

function isMemberAccess(node: ts.Node): node is MemberAccess {
  return (
    ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
  );
}

function memberName(node: MemberAccess): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
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
  const path = specifier.text.startsWith("@/")
    ? resolve(CORE_SRC, specifier.text.slice(2))
    : resolve(dirname(declaration.getSourceFile().fileName), specifier.text);
  if (module.startsWith("@sokosumi/")) return specifier.text === module;
  const target = resolve(CORE_SRC, module);
  return path === target || path === `${target}.js` || path === `${target}.ts`;
}

function declarationOf(
  node: ts.Node,
  bindings: ts.TypeChecker,
): ts.Declaration | undefined {
  return bindings.getSymbolAtLocation(node)?.declarations?.[0];
}

function constInitializer(
  declaration: ts.Declaration | undefined,
  reference: ts.Identifier,
): ts.Expression | undefined {
  if (
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    declaration.parent.flags & ts.NodeFlags.Const &&
    declaration.end < reference.pos
  ) {
    return declaration.initializer;
  }
}

function importedName(
  node: ts.Node,
  bindings: ts.TypeChecker,
  module: string,
  typePosition = false,
): string | undefined {
  const declaration = declarationOf(node, bindings);
  if (declaration && ts.isImportSpecifier(declaration)) {
    const clause = declaration.parent.parent;
    if (
      (typePosition || (!declaration.isTypeOnly && !clause.isTypeOnly)) &&
      importsFrom(clause.parent, module)
    ) {
      return (declaration.propertyName ?? declaration.name).text;
    }
  }
}

function isDefaultClient(
  expression: ts.Expression,
  bindings: ts.TypeChecker,
): boolean {
  expression = unwrap(expression);
  if (ts.isIdentifier(expression)) {
    const declaration = declarationOf(expression, bindings);
    if (declaration && ts.isImportClause(declaration)) {
      return (
        !declaration.isTypeOnly &&
        importsFrom(declaration.parent, "lib/db/prisma")
      );
    }
    if (importedName(expression, bindings, "lib/db/prisma") === "default")
      return true;
    const initializer = constInitializer(declaration, expression);
    return !!initializer && isDefaultClient(initializer, bindings);
  }
  if (
    isMemberAccess(expression) &&
    memberName(expression) === "default" &&
    ts.isIdentifier(expression.expression)
  ) {
    const declaration = declarationOf(expression.expression, bindings);
    return (
      !!declaration &&
      ts.isNamespaceImport(declaration) &&
      !declaration.parent.isTypeOnly &&
      importsFrom(declaration.parent.parent, "lib/db/prisma")
    );
  }
  return false;
}

function prismaType(
  name: ts.EntityName,
  bindings: ts.TypeChecker,
): string | undefined {
  if (
    ts.isQualifiedName(name) &&
    ts.isIdentifier(name.left) &&
    (importedName(name.left, bindings, "@sokosumi/database", true) ===
      "Prisma" ||
      importedName(name.left, bindings, "@sokosumi/database/client", true) ===
        "PrismaRaw")
  ) {
    return name.right.text;
  }
}

function callbackTransaction(
  callback: ts.Node,
  bindings: ts.TypeChecker,
): callback is ts.ArrowFunction | ts.FunctionExpression {
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
    return false;
  const call = callback.parent;
  if (!ts.isCallExpression(call) || call.arguments[0] !== callback)
    return false;
  const method = unwrap(call.expression);
  if (ts.isIdentifier(method)) {
    const helper = importedName(method, bindings, "lib/db/transaction");
    return (
      helper === "serializableTransaction" || helper === "retriedTransaction"
    );
  }
  return (
    isMemberAccess(method) &&
    memberName(method) === "$transaction" &&
    isDefaultClient(method.expression, bindings)
  );
}

function declaredTypeName(
  declaration: ts.Declaration | undefined,
): ts.EntityName | undefined {
  if (
    !declaration ||
    (!ts.isParameter(declaration) && !ts.isVariableDeclaration(declaration))
  )
    return;
  if (declaration.type && ts.isTypeReferenceNode(declaration.type))
    return declaration.type.typeName;
}

function isAuthedRouteContext(
  expression: ts.Expression,
  bindings: ts.TypeChecker,
): boolean {
  if (!ts.isIdentifier(expression)) return false;
  const context = declarationOf(expression, bindings);
  if (!context || !ts.isParameter(context)) return false;
  const handler = context.parent;
  if (
    (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) ||
    handler.parameters[0] !== context
  )
    return false;
  const call = handler.parent;
  if (
    !ts.isCallExpression(call) ||
    call.arguments[1] !== handler ||
    !isMemberAccess(call.expression) ||
    memberName(call.expression) !== "openapi" ||
    !ts.isIdentifier(call.expression.expression)
  )
    return false;
  const app = declarationOf(call.expression.expression, bindings);
  const name = declaredTypeName(app);
  if (
    name &&
    ts.isIdentifier(name) &&
    importedName(name, bindings, "lib/hono", true) === "OpenAPIHonoWithAuth"
  )
    return true;
  const initializer = constInitializer(app, call.expression.expression);
  return (
    !!initializer &&
    ts.isNewExpression(initializer) &&
    importedName(initializer.expression, bindings, "lib/hono") ===
      "OpenAPIHonoWithAuth"
  );
}

function isScope(expression: ts.Expression, bindings: ts.TypeChecker): boolean {
  expression = unwrap(expression);
  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    return (
      importedName(expression.expression, bindings, "lib/db/network-scope") ===
      "createNetworkScope"
    );
  }
  if (isMemberAccess(expression) && memberName(expression) === "networkScope") {
    const variables = unwrap(expression.expression);
    return (
      isMemberAccess(variables) &&
      memberName(variables) === "var" &&
      isAuthedRouteContext(unwrap(variables.expression), bindings)
    );
  }
  if (!ts.isIdentifier(expression)) return false;
  const declaration = declarationOf(expression, bindings);
  const name = declaredTypeName(declaration);
  if (
    name &&
    ts.isIdentifier(name) &&
    importedName(name, bindings, "lib/db/network-scope", true) ===
      "NetworkScope"
  )
    return true;
  const initializer = constInitializer(declaration, expression);
  return !!initializer && isScope(initializer, bindings);
}

function scopeSideName(
  name: string | undefined,
): "networkDb" | "sharedDb" | undefined {
  if (name === "networkDb" || name === "sharedDb") return name;
}

function scopeSide(
  expression: ts.Expression,
  bindings: ts.TypeChecker,
): "networkDb" | "sharedDb" | undefined {
  expression = unwrap(expression);
  if (isMemberAccess(expression)) {
    const side = scopeSideName(memberName(expression));
    return side && isScope(expression.expression, bindings) ? side : undefined;
  }
  if (!ts.isIdentifier(expression)) return;
  const declaration = declarationOf(expression, bindings);
  if (
    declaration &&
    ts.isBindingElement(declaration) &&
    !declaration.initializer &&
    !declaration.dotDotDotToken &&
    ts.isObjectBindingPattern(declaration.parent)
  ) {
    const key = declaration.propertyName ?? declaration.name;
    const side =
      ts.isIdentifier(key) || ts.isStringLiteralLike(key)
        ? scopeSideName(key.text)
        : undefined;
    const initializer = constInitializer(declaration.parent.parent, expression);
    if (side && initializer && isScope(initializer, bindings)) return side;
  }
  const initializer = constInitializer(declaration, expression);
  return initializer ? scopeSide(initializer, bindings) : undefined;
}

function isPrismaClient(
  expression: ts.Expression,
  bindings: ts.TypeChecker,
): boolean {
  expression = unwrap(expression);
  if (isDefaultClient(expression, bindings) || scopeSide(expression, bindings))
    return true;
  if (!ts.isIdentifier(expression)) return false;
  const declaration = declarationOf(expression, bindings);
  const name = declaredTypeName(declaration);
  if (name && prismaType(name, bindings) === "TransactionClient") return true;
  if (name && ts.isIdentifier(name)) {
    const side = importedName(name, bindings, "lib/db/network-scope", true);
    if (
      side === "NetworkDb" ||
      side === "SharedDb" ||
      importedName(name, bindings, "lib/db/prisma", true) === "DbClient"
    )
      return true;
  }
  if (
    declaration &&
    ts.isParameter(declaration) &&
    declaration.parent.parameters[0] === declaration &&
    callbackTransaction(declaration.parent, bindings)
  )
    return true;
  const initializer = constInitializer(declaration, expression);
  return !!initializer && isPrismaClient(initializer, bindings);
}

type RelationContext =
  | "args"
  | "include"
  | "select"
  | "where"
  | "relation filter";
const relationTypes = new Map<
  string,
  { model: string; context: RelationContext }
>();
for (const model of modelsByDelegate.values()) {
  relationTypes.set(`${model}Include`, { model, context: "include" });
  relationTypes.set(`${model}Select`, { model, context: "select" });
  relationTypes.set(`${model}WhereInput`, { model, context: "where" });
  relationTypes.set(`${model}WhereUniqueInput`, { model, context: "where" });
}

function resolveLiteral(
  expression: ts.Expression,
  bindings: ts.TypeChecker,
): ts.Expression {
  expression = unwrap(expression);
  if (!ts.isIdentifier(expression)) return expression;
  const declaration = ts.isShorthandPropertyAssignment(expression.parent)
    ? bindings.getShorthandAssignmentValueSymbol(expression.parent)
        ?.valueDeclaration
    : declarationOf(expression, bindings);
  const initializer = constInitializer(declaration, expression);
  return initializer ? resolveLiteral(initializer, bindings) : expression;
}

function* propertiesInReverse(
  literal: ts.ObjectLiteralExpression,
  bindings: ts.TypeChecker,
): Generator<[string, ts.PropertyName, ts.Expression] | undefined> {
  for (const property of [...literal.properties].reverse()) {
    if (ts.isSpreadAssignment(property)) {
      const spread = resolveLiteral(property.expression, bindings);
      if (ts.isObjectLiteralExpression(spread)) {
        yield* propertiesInReverse(spread, bindings);
        continue;
      }
    }
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property)
    ) {
      yield undefined;
      return;
    }
    const key = property.name;
    const name = ts.isComputedPropertyName(key) ? unwrap(key.expression) : key;
    if (
      (!ts.isIdentifier(name) && !ts.isStringLiteralLike(name)) ||
      (ts.isComputedPropertyName(key) && ts.isIdentifier(name))
    ) {
      yield undefined;
      return;
    }
    yield [
      name.text,
      key,
      ts.isPropertyAssignment(property) ? property.initializer : property.name,
    ];
  }
}

const logicalFilters = new Set(["AND", "OR", "NOT"]);
const relationFilters = new Set(["is", "isNot", "some", "none", "every"]);

function walkRelations(
  expression: ts.Expression,
  model: string,
  context: RelationContext,
  bindings: ts.TypeChecker,
  report: (node: ts.Node, reason: string) => void,
): void {
  const literal = resolveLiteral(expression, bindings);
  if (context === "where" && ts.isArrayLiteralExpression(literal)) {
    for (const element of literal.elements)
      walkRelations(element, model, context, bindings, report);
    return;
  }
  if (!ts.isObjectLiteralExpression(literal)) return;

  const seen = new Set<string>();
  for (const property of propertiesInReverse(literal, bindings)) {
    // An unknown key or spread may override any earlier field.
    if (!property) break;
    const [name, key, child] = property;
    if (seen.has(name)) continue;
    seen.add(name);

    if (context === "args") {
      if (name === "include" || name === "select" || name === "where") {
        walkRelations(child, model, name, bindings, report);
      }
      continue;
    }

    const filtering = context === "where" || context === "relation filter";
    if (
      filtering &&
      (logicalFilters.has(name) ||
        (context === "relation filter" && relationFilters.has(name)))
    ) {
      walkRelations(child, model, "where", bindings, report);
      continue;
    }
    const related = modelRelations.get(model)?.get(name);
    if (!related) continue;
    const resolved = resolveLiteral(child, bindings);
    if (
      resolved.kind === ts.SyntaxKind.FalseKeyword ||
      (ts.isIdentifier(resolved) &&
        resolved.text === "undefined" &&
        !declarationOf(resolved, bindings))
    )
      continue;

    if (networkModels.has(model) !== networkModels.has(related)) {
      report(
        key,
        `${model}.${name} → ${related} (${filtering ? "where" : context})`,
      );
    }
    walkRelations(
      child,
      related,
      filtering ? "relation filter" : "args",
      bindings,
      report,
    );
  }
}

function typedRelation(
  node: ts.Node,
  bindings: ts.TypeChecker,
  report: (node: ts.Node, reason: string) => void,
): void {
  if (!ts.isVariableDeclaration(node) && !ts.isSatisfiesExpression(node))
    return;
  const type = node.type;
  const value = ts.isVariableDeclaration(node)
    ? node.initializer
    : node.expression;
  if (!value || !type || !ts.isTypeReferenceNode(type)) return;
  const relation = relationTypes.get(prismaType(type.typeName, bindings) ?? "");
  if (relation)
    walkRelations(value, relation.model, relation.context, bindings, report);
}

function isNetworkDbPick(
  type: ts.TypeNode | undefined,
  bindings: ts.TypeChecker,
): boolean {
  if (!type) return false;
  if (ts.isParenthesizedTypeNode(type))
    return isNetworkDbPick(type.type, bindings);
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName))
    return false;

  const name = type.typeName;
  const declaration = declarationOf(name, bindings);
  if (
    declaration &&
    ts.isTypeAliasDeclaration(declaration) &&
    !declaration.typeParameters &&
    declaration.end < type.pos
  ) {
    return isNetworkDbPick(declaration.type, bindings);
  }

  // The binder runs without lib.d.ts. A local Pick has a binding; the
  // standard utility type does not.
  if (name.text !== "Pick" || declaration) return false;
  const target = type.typeArguments?.[0];
  return (
    !!target &&
    ts.isTypeReferenceNode(target) &&
    ts.isIdentifier(target.typeName) &&
    importedName(target.typeName, bindings, "lib/db/network-scope", true) ===
      "NetworkDb"
  );
}

function assertAllowlist(
  label: string,
  allowlist: string,
  findings: Map<string, string[]>,
): void {
  const allowed = readFileSync(new URL(allowlist, import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean);
  console.log(`Network old path, ${label}: ${findings.size} files`);
  expect
    .soft(
      {
        new: [...findings]
          .filter(([file]) => !allowed.includes(file))
          .flatMap(([, locations]) => locations),
        stale: allowed.filter((file) => !findings.has(file)),
      },
      "Use the Network scope for new calls and remove each allowlist entry when its last call moves.",
    )
    .toEqual({ new: [], stale: [] });
}

it("keeps the Network allowlists from growing or going stale", () => {
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
  }).sort();
  // Use TypeScript's lexical bindings without loading imports or checking types.
  const program = ts.createProgram(
    files.map((file) => resolve(CORE_SRC, file)),
    {
      noResolve: true,
      noLib: true,
      types: [],
      allowJs: true,
    },
  );
  const bindings = program.getTypeChecker();
  const defaultCalls = new Map<string, string[]>();
  const relations = new Map<string, string[]>();
  const networkDbPicks: string[] = [];
  const clientsInTransactions: string[] = [];

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
    function visit(node: ts.Node, insideTransaction = false): void {
      // A nested function can run after the transaction ends.
      if (ts.isFunctionLike(node))
        insideTransaction = callbackTransaction(node, bindings);
      if (
        insideTransaction &&
        (ts.isIdentifier(node) || isMemberAccess(node))
      ) {
        const side = scopeSide(node, bindings);
        if (side) clientsInTransactions.push(`${location(node)} ${side}`);
      }
      if (ts.isCallExpression(node)) {
        const operation = unwrap(node.expression);
        if (isMemberAccess(operation)) {
          const delegate = unwrap(operation.expression);
          if (isMemberAccess(delegate)) {
            const model = modelsByDelegate.get(memberName(delegate) ?? "");
            if (
              model &&
              networkModels.has(model) &&
              isDefaultClient(delegate.expression, bindings)
            ) {
              calls.push(location(node));
            }
            if (
              model &&
              node.arguments[0] &&
              isPrismaClient(delegate.expression, bindings)
            ) {
              walkRelations(
                node.arguments[0],
                model,
                "args",
                bindings,
                reportRelation,
              );
            }
          }
        }
      }
      typedRelation(node, bindings, reportRelation);
      if (ts.isParameter(node) && isNetworkDbPick(node.type, bindings)) {
        networkDbPicks.push(location(node));
      }
      ts.forEachChild(node, (child) => visit(child, insideTransaction));
    }
    visit(source);
    if (calls.length) defaultCalls.set(file, calls);
    if (crossings.size) relations.set(file, [...crossings]);
  }

  console.log(
    `Network old path scan: ${files.length} sources in ${Math.round(performance.now() - started)} ms`,
  );
  assertAllowlist(
    "default client Network calls",
    "network-default-client-allowlist.txt",
    defaultCalls,
  );
  assertAllowlist(
    "cross-schema relations",
    "network-relation-allowlist.txt",
    relations,
  );
  expect
    .soft(
      networkDbPicks,
      "Take NetworkDb whole so the parameter retains its brand.",
    )
    .toEqual([]);
  expect
    .soft(
      clientsInTransactions,
      "Use the transaction callback's client in place of the scope client.",
    )
    .toEqual([]);
});
