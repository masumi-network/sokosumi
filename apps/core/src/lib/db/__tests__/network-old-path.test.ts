import { globSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";
import { expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));
const CORE_SRC = resolve(ROOT, "apps/core/src");
const networkTables = JSON.parse(
  readFileSync(
    resolve(ROOT, "packages/database/prisma/network-tables.json"),
    "utf8",
  ),
) as { network: Record<string, string> };
const networkDelegates = new Set(
  Object.keys(networkTables.network).map(
    (model) => model.charAt(0).toLowerCase() + model.slice(1),
  ),
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
  const target = resolve(CORE_SRC, module);
  return path === target || path === `${target}.js` || path === `${target}.ts`;
}

function isDefaultClient(
  expression: ts.Expression,
  bindings: ts.TypeChecker,
): boolean {
  expression = unwrap(expression);
  if (ts.isIdentifier(expression)) {
    const declaration =
      bindings.getSymbolAtLocation(expression)?.declarations?.[0];
    if (!declaration) return false;
    if (ts.isImportClause(declaration)) {
      return (
        !declaration.isTypeOnly &&
        importsFrom(declaration.parent, "lib/db/prisma")
      );
    }
    if (ts.isImportSpecifier(declaration)) {
      return (
        (declaration.propertyName ?? declaration.name).text === "default" &&
        !declaration.isTypeOnly &&
        !declaration.parent.parent.isTypeOnly &&
        importsFrom(declaration.parent.parent.parent, "lib/db/prisma")
      );
    }
    if (
      ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      declaration.parent.flags & ts.NodeFlags.Const &&
      declaration.initializer &&
      declaration.end < expression.pos
    ) {
      return isDefaultClient(declaration.initializer, bindings);
    }
  }
  if (
    isMemberAccess(expression) &&
    memberName(expression) === "default" &&
    ts.isIdentifier(expression.expression)
  ) {
    const declaration = bindings.getSymbolAtLocation(expression.expression)
      ?.declarations?.[0];
    return (
      !!declaration &&
      ts.isNamespaceImport(declaration) &&
      !declaration.parent.isTypeOnly &&
      importsFrom(declaration.parent.parent, "lib/db/prisma")
    );
  }
  return false;
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
  expect(
    {
      new: [...findings]
        .filter(([file]) => !allowed.includes(file))
        .flatMap(([, locations]) => locations),
      stale: allowed.filter((file) => !findings.has(file)),
    },
    "Use the Network scope for new calls and remove each allowlist entry when its last call moves.",
  ).toEqual({ new: [], stale: [] });
}

it("keeps the default client Network allowlist from growing or going stale", () => {
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
  const findings = new Map<string, string[]>();

  for (const source of program.getSourceFiles()) {
    const locations: string[] = [];
    const file = relative(ROOT, source.fileName);
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const operation = unwrap(node.expression);
        if (isMemberAccess(operation)) {
          const delegate = unwrap(operation.expression);
          if (
            isMemberAccess(delegate) &&
            networkDelegates.has(memberName(delegate) ?? "") &&
            isDefaultClient(delegate.expression, bindings)
          ) {
            const { line } = ts.getLineAndCharacterOfPosition(
              source,
              node.getStart(source),
            );
            locations.push(`${file}:${line + 1}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (locations.length) findings.set(file, locations);
  }

  console.log(
    `Network old path scan: ${files.length} sources in ${Math.round(performance.now() - started)} ms`,
  );
  assertAllowlist(
    "default client Network calls",
    "network-default-client-allowlist.txt",
    findings,
  );
});
