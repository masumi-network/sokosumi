import { globSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";

import { NETWORKS } from "@/lib/network";

// Preprod costs no credits, and one place says so: `lib/credits/policy.ts`.
// A payer or reader of credits asks the module, never the Network. This finds
// a comparison with a Network's name (`=== "preprod"`, `case "mainnet":`), or
// with a local `const` that holds one, in the credits module, in every file
// that imports it (in any spelling of the path) and in the payers' and
// readers' entry points, which may reach it only through a helper.
//
// Known gaps: a lexical scan of the syntax tree. It does not see a Network
// name held in an imported constant, a `Set` or `includes` lookup, a map
// keyed by Network, or a file that reaches the module through a re-export
// and is not listed below.
const CORE_SRC = fileURLToPath(new URL("../../..", import.meta.url));
const POLICY = "lib/credits/policy.ts";
/** The payers and readers of credits, also those that reach the module through a helper. */
const ENTRY_POINTS = [
  "helpers/job.ts",
  "helpers/task-credits.ts",
  "helpers/task-event-charge.ts",
  "routes/v1/tasks/[id]/events/post.ts",
  "routes/v1/tasks/[id]/x402-payments/post.ts",
  "services/task-x402-payment.service.ts",
  "routes/v1/coworkers/me/usage/post.ts",
  "routes/v1/transactions/get.ts",
  "routes/v1/transactions/total/get.ts",
  "routes/v1/transactions/daily/get.ts",
  "routes/v1/transactions/export/get.ts",
  "routes/v1/users/[id]/credits/get.ts",
  "routes/v1/users/[id]/organizations/[organizationId]/credits/get.ts",
  "routes/v1/admin/credits/post.ts",
  "services/free-credit-admin.service.ts",
];
const NETWORK_NAMES: ReadonlySet<string> = new Set(NETWORKS);
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isNetworkLiteral(node: ts.Expression): boolean {
  const value = unwrap(node);
  return ts.isStringLiteralLike(value) && NETWORK_NAMES.has(value.text);
}

/** The names of the file's `const` declarations whose value is a Network's name. */
function networkConstants(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclarationList(node) && node.flags & ts.NodeFlags.Const) {
      for (const declaration of node.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          isNetworkLiteral(declaration.initializer)
        ) {
          names.add(declaration.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** `line:column` of each comparison with a Network's name in `source`. */
export function networkBranches(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest);
  const constants = networkConstants(file);
  const isNetworkName = (node: ts.Expression) => {
    const value = unwrap(node);
    return (
      isNetworkLiteral(value) ||
      (ts.isIdentifier(value) && constants.has(value.text))
    );
  };
  const found: string[] = [];
  const at = (node: ts.Node) => {
    const { line, character } = file.getLineAndCharacterOfPosition(
      node.getStart(file),
    );
    found.push(`${line + 1}:${character + 1}`);
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      EQUALITY.has(node.operatorToken.kind) &&
      (isNetworkName(node.left) || isNetworkName(node.right))
    ) {
      at(node);
    }
    if (ts.isCaseClause(node) && isNetworkName(node.expression)) at(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The path below `src/` an import names, for `@/` and relative imports. */
function importedPath(from: string, specifier: string): string | undefined {
  if (specifier.startsWith("@/")) return specifier.slice(2);
  if (specifier.startsWith(".")) {
    return relative(CORE_SRC, resolve(CORE_SRC, dirname(from), specifier));
  }
  return undefined;
}

/** Whether `source` is in the credits module, imports it, or is an entry point. */
function usesCredits(path: string, source: string): boolean {
  if (path.startsWith("lib/credits/") || ENTRY_POINTS.includes(path)) {
    return true;
  }
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest);
  return file.statements.some((statement) => {
    if (
      !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
    )
      return false;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) return false;
    return importedPath(path, specifier.text)?.startsWith("lib/credits/");
  });
}

describe("the credits module's Network branch", () => {
  it("finds a comparison with a Network's name, and only that", () => {
    expect(
      networkBranches(
        "x.ts",
        [
          'if (scope.network === "preprod") skip();',
          'const a = "mainnet" !== network;',
          'switch (network) { case "preprod": break; }',
          'const b = network === "other";',
          "const c = { mainnet: true, preprod: false };",
          'const TEST_NET = "preprod" as const;',
          "if (network === TEST_NET) skip();",
          'if ((network as string) === ("mainnet" satisfies string)) skip();',
        ].join("\n"),
      ),
    ).toEqual(["1:5", "2:11", "3:20", "7:5", "8:5"]);
  });

  it("is decided only in the policy, in the module and in every file that uses it", () => {
    const files = globSync("**/*.ts", {
      cwd: CORE_SRC,
      exclude: (name) =>
        name.endsWith(".test.ts") || name === "__tests__" || name === "test",
    });
    const scanned: string[] = [];
    const found: string[] = [];
    for (const name of files) {
      const path = relative(CORE_SRC, resolve(CORE_SRC, name));
      if (path === POLICY) continue;
      const source = readFileSync(resolve(CORE_SRC, name), "utf8");
      if (!usesCredits(path, source)) continue;
      scanned.push(path);
      for (const where of networkBranches(path, source)) {
        found.push(`${path}:${where}`);
      }
    }

    // The scan reached the module and its payers, not an empty list.
    expect(scanned).toEqual(
      expect.arrayContaining([
        "lib/credits/spend.ts",
        "helpers/job.ts",
        "helpers/task-credits.ts",
        "routes/v1/coworkers/me/usage/post.ts",
        "lib/credits/view.ts",
        // Reaches the module through `task-event-charge`, not by importing it.
        "routes/v1/tasks/[id]/events/post.ts",
        // Imports it by a relative path.
        "lib/credits/grant.ts",
      ]),
    );
    for (const entry of ENTRY_POINTS) expect(scanned).toContain(entry);
    expect(found).toEqual([]);
  });
});
