import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");

async function readRepoFile(...segments) {
  return readFile(path.join(repoRoot, ...segments), "utf8");
}

describe("JS CI caches", () => {
  it("only next-build-cache.yml saves, so PR runs never fill the cache", async () => {
    // A PR-saved entry is scoped to refs/pull/N/merge: no sibling PR can
    // read it, and ~20 copies of the pnpm store once filled the 10 GB.
    const savers = [];
    for (const file of await readdir(workflowsDir)) {
      const text = await readFile(path.join(workflowsDir, file), "utf8");
      if (/actions\/cache\/save@|actions\/cache@/.test(text)) {
        savers.push(file);
      }
    }
    // apple.yml's Warm Apple caches job saves Mint, Swift packages and
    // Xcode's compilation cache from main (schedule / workflow_dispatch).
    assert.deepEqual(savers.sort(), ["apple.yml", "next-build-cache.yml"]);

    const warm = await readRepoFile(
      ".github",
      "workflows",
      "next-build-cache.yml",
    );
    const triggers = warm.split(/^jobs:/m)[0];
    assert.doesNotMatch(triggers, /^\s+pull_request/m);
  });

  it("keys JS caches under js- so they never match Apple's", async () => {
    const files = [
      await readRepoFile(".github", "workflows", "ci.yml"),
      await readRepoFile(".github", "workflows", "next-build-cache.yml"),
    ];
    for (const text of files) {
      for (const [, key] of text.matchAll(/\n\s+(?:restore-)?keys?: (.+)/g)) {
        if (key.startsWith("${{ steps.")) {
          continue;
        }
        assert.match(key, /^js-/, `cache key ${key} lacks the js- prefix`);
      }
    }
  });

  it("builds web with the same env in CI and the cache warmer", async () => {
    for (const file of ["ci.yml", "next-build-cache.yml"]) {
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

function jobBlock(yaml, jobId) {
  const match = yaml.match(
    new RegExp(`(?:^|\\n)  ${jobId}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z]|$)`),
  );
  assert.ok(match, `missing job ${jobId}`);
  return match[0];
}

describe("Apple CI triggers", () => {
  it("keeps required check names and stops test/lint on push to main", async () => {
    const yaml = await readRepoFile(".github", "workflows", "apple.yml");
    const test = jobBlock(yaml, "test");
    const lint = jobBlock(yaml, "lint");
    const warm = jobBlock(yaml, "warm");
    const publish = jobBlock(yaml, "publish");

    assert.match(test, /name: Xcode test/);
    assert.match(lint, /name: Swift lint and format/);
    assert.match(warm, /name: Warm Apple caches/);
    assert.match(publish, /name: Publish macOS DMG/);

    assert.match(
      test,
      /if: github\.event_name == 'pull_request' && needs\.changes\.outputs\.apple == 'true'/,
    );
    assert.match(
      lint,
      /if: github\.event_name == 'pull_request' && needs\.changes\.outputs\.apple == 'true'/,
    );
    assert.doesNotMatch(test, /github\.event_name == 'push'/);
    assert.doesNotMatch(lint, /github\.event_name == 'push'/);

    assert.match(
      warm,
      /if: github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/,
    );
    assert.match(yaml, /cron: "17 3 \* \* \*"/);

    assert.doesNotMatch(publish, /needs:/);
    assert.match(
      publish,
      /if: github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/,
    );

    const spmKey =
      /\${{ runner\.os }}-spm-\${{ hashFiles\('apps\/apple\/Sokosumi\.xcworkspace\/xcshareddata\/swiftpm\/Package\.resolved'\) }}/;
    const mintKey =
      /\${{ runner\.os }}-mint-\${{ hashFiles\('apps\/apple\/Mintfile'\) }}/;
    const casKey = /\${{ runner\.os }}-xcode-cas-\${{ github\.run_id }}/;
    for (const key of [spmKey, casKey]) {
      assert.match(test, key);
      assert.match(warm, key);
    }
    assert.match(lint, mintKey);
    assert.match(warm, mintKey);
  });
});

describe("CodeQL JS drafts", () => {
  it("skips draft PRs and re-runs on ready_for_review", async () => {
    const yaml = await readRepoFile(".github", "workflows", "codeql.yml");
    assert.match(
      yaml,
      /types: \[opened, synchronize, reopened, ready_for_review\]/,
    );
    assert.match(
      yaml,
      /if: github\.event_name != 'pull_request' \|\| !github\.event\.pull_request\.draft/,
    );
  });
});
