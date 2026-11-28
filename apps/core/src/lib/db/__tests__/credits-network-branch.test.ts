import { globSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";

import { NETWORKS } from "@/lib/network";

// Preprod costs no credits, and one place says so: `lib/credits/policy.ts`.
// A payer or reader of credits asks the module, never the Network. This finds
// a comparison with a Network's name (`=== "preprod"`, `case "mainnet":`) in
// the credits module and in every file that imports it.
//
// Known gaps: a lexical scan of the syntax tree. It does not see a Network
// name held in a constant, a `Set` or `includes` lookup, a map keyed by
// Network, or a file that reaches the module through a re-export.
const CORE_SRC = fileURLToPath(new URL("../../..", import.meta.url));
const POLICY = "lib/credits/policy.ts";
const NETWORK_NAMES: ReadonlySet<string> = new Set(NETWORKS);
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

function isNetworkName(node: ts.Node): boolean {
  return ts.isStringLiteralLike(node) && NETWORK_NAMES.has(node.text);
}

/** `line:column` of each comparison with a Network's name in `source`. */
export function networkBranches(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest);
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

/** Whether `source` is in the credits module or imports it. */
function usesCredits(path: string, source: string): boolean {
  if (path.startsWith("lib/credits/")) return true;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest);
  return file.statements.some(
    (statement) =>
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith("@/lib/credits/"),
  );
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
        ].join("\n"),
      ),
    ).toEqual(["1:5", "2:11", "3:20"]);
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
      ]),
    );
    expect(found).toEqual([]);
  });
});
