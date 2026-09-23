import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");

async function readRepoFile(...segments) {
  return readFile(path.join(repoRoot, ...segments), "utf8");
}

describe("JS dependency caches", () => {
  it("only js-cache.yml saves, so PR runs never fill the cache", async () => {
    // A PR-saved entry is scoped to refs/pull/N/merge: no sibling PR can
    // read it, and ~20 copies of the pnpm store once filled the 10 GB.
    const savers = [];
    for (const file of await readdir(workflowsDir)) {
      const text = await readFile(path.join(workflowsDir, file), "utf8");
      if (
        /save_cache:\s*"true"|actions\/cache\/save@|actions\/cache@/.test(text)
      ) {
        savers.push(file);
      }
    }
    // apple.yml saves ~/.mint from main pushes with actions/cache.
    assert.deepEqual(savers.sort(), ["apple.yml", "js-cache.yml"]);

    const warm = await readRepoFile(".github", "workflows", "js-cache.yml");
    const triggers = warm.split(/^jobs:/m)[0];
    assert.doesNotMatch(triggers, /^\s+pull_request/m);
  });

  it("Setup restores node_modules and saves only when asked", async () => {
    const setup = await readRepoFile(
      ".github",
      "actions",
      "setup",
      "action.yml",
    );
    assert.match(setup, /uses: actions\/cache\/restore@\S+/);
    assert.match(
      setup,
      /if: inputs\.save_cache == 'true' && steps\.node-modules\.outputs\.cache-hit != 'true'\n\s+uses: actions\/cache\/save@/,
    );
    // A restored tree skips install, so workspace dist/ must be rebuilt.
    assert.match(setup, /run: pnpm -r --if-present run prepare/);
  });

  it("keys JS caches under js- so they never match Apple's", async () => {
    const files = [
      await readRepoFile(".github", "actions", "setup", "action.yml"),
      await readRepoFile(".github", "workflows", "ci.yml"),
      await readRepoFile(".github", "workflows", "js-cache.yml"),
    ];
    for (const text of files) {
      for (const [, key] of text.matchAll(/\n\s+(?:restore-)?keys?: (.+)/g)) {
        if (key.startsWith("${{ steps.")) continue;
        assert.match(key, /^js-/, `cache key ${key} lacks the js- prefix`);
      }
    }
  });

  it("builds web with the same env in CI and the cache warmer", async () => {
    for (const file of ["ci.yml", "js-cache.yml"]) {
      const text = await readRepoFile(".github", "workflows", file);
      assert.match(
        text,
        /run: grep -v '\^#' \.github\/ci-build\.env >> "\$GITHUB_ENV"/,
        `${file} must load .github/ci-build.env`,
      );
      assert.match(
        text,
        /DATABASE_URL: "postgresql:\/\/user:password@localhost:5432\/sokosumi"/,
      );
    }
  });
});
