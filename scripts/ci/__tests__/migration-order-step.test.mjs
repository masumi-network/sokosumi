import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const STEP_NAME = "Check migration folders against the base branch";

// The database package tests this step too, but Turbo's cache key ignores
// ci.yml. A PR that only deletes or skips the step would replay that pass.
// This suite runs without a cache whenever ci.yml or the step's test file
// changes.
describe("the Test Packages migration step", () => {
  it("is the last packages step and compares with the merge commit's first parent", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    const job = workflow.match(/\n {2}packages:\n[\s\S]*?(?=\n {2}[a-zA-Z]|$)/);
    assert.ok(job, "ci.yml has no packages job");
    // Blank and comment lines before the next job belong to no step. Any
    // other line there still belongs to this step, so it stays in the text.
    const step = job[0]
      .split(`      - name: ${STEP_NAME}\n`)[1]
      ?.replace(/(\n *(#.*)?)+$/, "\n");
    assert.ok(step, `the packages job has no "${STEP_NAME}" step`);

    // The whole rest of the job must be this text, so the step stays last,
    // and a changed condition, guard, base, or command fails here.
    assert.equal(
      step,
      [
        "        if: ${{ !cancelled() }}",
        "        env:",
        "          DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}",
        "        run: |",
        '          if [ "$GITHUB_EVENT_NAME" = pull_request ]; then',
        '            if [ "$(git rev-parse HEAD)" != "$GITHUB_SHA" ] || ! git rev-parse --verify --quiet "HEAD^2" >/dev/null; then',
        '              echo "::error::HEAD is not the pull request merge commit $GITHUB_SHA with both parents fetched, so HEAD^1 is not the base branch."',
        "              exit 1",
        "            fi",
        '            base="HEAD^1"',
        "          else",
        '            git fetch --no-tags --depth=1 origin "+refs/heads/$DEFAULT_BRANCH:refs/remotes/origin/$DEFAULT_BRANCH"',
        '            echo "::notice::Compared with origin/$DEFAULT_BRANCH. If this branch is behind it, its newer folders show as removed. Merge it first."',
        '            base="origin/$DEFAULT_BRANCH"',
        "          fi",
        '          MIGRATION_ORDER_BASE_REF="$base" pnpm --filter @sokosumi/database --fail-if-no-match exec vitest run --passWithNoTests=false src/helpers/migration-prefix-order.test.ts',
        "",
      ].join("\n"),
    );
  });

  it("keeps the step's test gated only on the base ref", async () => {
    const test = await readFile(
      path.join(
        repoRoot,
        "packages/database/src/helpers/migration-prefix-order.test.ts",
      ),
      "utf8",
    );
    // A skipped or renamed gate would let the step pass without the check.
    for (const line of [
      'const baseRefVariable = "MIGRATION_ORDER_BASE_REF";',
      "const baseRef = process.env[baseRefVariable];",
      'describe.skipIf(!baseRef)("prisma/migrations against the base ref", () => {',
      '  it("adds only stamped folders after the base\'s newest and keeps the rest", () => {',
    ]) {
      assert.ok(test.split("\n").includes(line), `missing: ${line}`);
    }
    assert.deepEqual(test.match(/\.(skip|skipIf|runIf|todo|only|fails)\b/g), [
      ".skipIf",
    ]);
    // Vitest also takes these as options, for example `it(name, { skip: true }, fn)`.
    assert.doesNotMatch(test, /\b(skip|only|todo|fails)\s*:/);
  });
});
