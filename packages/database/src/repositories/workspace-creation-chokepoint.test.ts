import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Every path that creates a workspace also seeds its Files vocabulary.
 *
 * A workspace with no vocabulary is not a workspace with a smaller feature.
 * The suggestion job counts the workspace's labels, finds none, completes
 * without calling the model and reports success — so automatic tagging does
 * nothing at all, quietly, forever, in any workspace whose creation path
 * forgot to seed. That is the failure this file exists to make loud.
 *
 * Asserted as a set of files rather than by mocking a creation, because the
 * risk is a *new* creation site written later by someone who has not read
 * `workspace.repository.ts`. A behavioural test of the existing sites cannot
 * fail for a site that does not exist yet; this one does, and the failure names
 * the file so its author has to decide rather than discover it in production.
 */

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * The known creation sites, with why each is allowed.
 *
 * `workspace.repository.ts` calls `seedCuratedVocabulary`
 * directly. `helpers/personal-workspace.ts` (behind both personal workspace
 * create routes) does not go through the repository and calls the same
 * exported function.
 */
const ALLOWED = [
  "packages/database/src/repositories/workspace.repository.ts",
  "apps/core/src/helpers/personal-workspace.ts",
].sort();

function filesCreatingAWorkspace(): string[] {
  // `git grep` rather than a recursive read: it honours .gitignore, so
  // node_modules and build output cannot make this pass or fail by accident.
  //
  // `--untracked` is load-bearing. Plain `git grep` searches tracked files
  // only, and a brand-new creation path is a brand-new file — untracked until
  // it is staged. Verified by adding one: without this flag the guard passed.
  const out = execFileSync(
    "git",
    [
      "grep",
      "-l",
      "--untracked",
      "-E",
      String.raw`(tx|prisma)\.workspace\.create\(`,
      "--",
      "apps",
      "packages",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  return (
    out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // Generated Prisma client documentation contains `prisma.workspace.create`
      // in an example comment. It creates nothing.
      .filter((line) => !line.includes("/generated/"))
      // Test fixtures create workspaces to test other things and are not a
      // product creation path. They are covered by the postgres seed test.
      .filter((line) => !/\.test\.ts$/.test(line))
      .sort()
  );
}

describe("workspace creation seeds the Files vocabulary", () => {
  it("has exactly the creation sites this guard knows about", () => {
    expect(
      filesCreatingAWorkspace(),
      "A new workspace.create( appeared. A workspace with no Files " +
        "vocabulary silently produces no tags ever, so route the new path " +
        "through workspaceRepository.seedCuratedVocabulary and add it here.",
    ).toEqual(ALLOWED);
  });

  it("is still watching a repository that creates workspaces", () => {
    // A guard whose pattern has rotted passes by finding nothing.
    expect(filesCreatingAWorkspace().length).toBeGreaterThan(0);
  });
});
