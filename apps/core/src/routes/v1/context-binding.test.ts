import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Structural guard for SOK-1020.
 *
 * Coworker and Soko Bot keys are authorized for one workspace, but routes that
 * resolve an organization or workspace from the request check membership of the
 * **user**. Any such route an agent key can reach must also bind the target to
 * the caller's context.
 *
 * Scope, stated exactly, because a guard that overclaims is worse than none:
 *
 * - Only the three trees below are scanned. They are the ones that take an
 *   organization or workspace identifier straight from the request path.
 * - Within them, only files under a dynamic path segment are required to bind.
 *   A route with no identifier in its path has nothing to bind.
 * - Agent admission is either `requireAuthorizedUserContext` or the users-tree
 *   `requireUserRouteContext`. Routes using `requireOwnerUserContext` or
 *   `requireUserAuthContext` reject agents outright and need no binding.
 *
 * This is a substring scan. It proves a binding call is present, not that it
 * was passed the right identifier. The route tests do that.
 */

const ROUTES_V1_DIR = fileURLToPath(new URL(".", import.meta.url));

/**
 * `pattern` is a glob, so a literal `[id]` directory has to be matched with a
 * wildcard: brackets are a character class. `prefix` is what the matched paths
 * start with.
 */
const SCANNED_TREES = [
  { pattern: "organizations/**/*.ts", prefix: "organizations/" },
  { pattern: "workspaces/**/*.ts", prefix: "workspaces/" },
  { pattern: "users/*/organizations/**/*.ts", prefix: "users/" },
] as const;

const AGENT_ADMISSION_SYMBOLS = [
  "requireAuthorizedUserContext",
  "requireUserRouteContext",
] as const;

const CONTEXT_BINDING_SYMBOLS = [
  "assertOrganizationInContextScope",
  "assertOrganizationSlugInContextScope",
  "assertWorkspaceInContextScope",
  "contextOrganizationMemberFilter",
] as const;

function scannedRouteFiles(): string[] {
  return SCANNED_TREES.flatMap((tree) =>
    globSync(tree.pattern, {
      cwd: ROUTES_V1_DIR,
      exclude: (file) => file.endsWith(".test.ts"),
    }),
  )
    .filter((file) => file.includes("["))
    .sort();
}

describe("routes that resolve an organization or workspace from the request", () => {
  it("binds the target to the caller's context when an agent key can reach it", () => {
    const missingBinding = scannedRouteFiles().filter((file) => {
      const source = readFileSync(join(ROUTES_V1_DIR, file), "utf8");

      const admitsAgents = AGENT_ADMISSION_SYMBOLS.some((symbol) =>
        source.includes(symbol),
      );

      if (!admitsAgents) {
        return false;
      }

      return !CONTEXT_BINDING_SYMBOLS.some((symbol) => source.includes(symbol));
    });

    expect(missingBinding).toEqual([]);
  });

  it("scans every tree, so a renamed directory fails loudly", () => {
    const scanned = scannedRouteFiles();

    expect(scanned.length).toBeGreaterThan(10);

    for (const tree of SCANNED_TREES) {
      expect(scanned.some((file) => file.startsWith(tree.prefix))).toBe(true);
    }
  });
});
