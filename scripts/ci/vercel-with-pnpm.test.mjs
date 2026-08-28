import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const script = path.join(import.meta.dirname, "vercel-with-pnpm.mjs");

describe("vercel-with-pnpm", () => {
  it("exits with usage when command is missing", () => {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /usage: vercel-with-pnpm\.mjs/);
  });

  it("is wired as install and build commands for web and core", async () => {
    const web = JSON.parse(
      await readFile(path.join(repoRoot, "apps/web/vercel.json"), "utf8"),
    );
    const core = JSON.parse(
      await readFile(path.join(repoRoot, "apps/core/vercel.json"), "utf8"),
    );
    assert.equal(
      web.installCommand,
      "node ../../scripts/ci/vercel-with-pnpm.mjs pnpm install --filter web...",
    );
    assert.equal(
      web.buildCommand,
      "node ../../scripts/ci/vercel-with-pnpm.mjs node ./scripts/vercel-build.mjs",
    );
    assert.equal(
      core.installCommand,
      "node ../../scripts/ci/vercel-with-pnpm.mjs pnpm install --filter @sokosumi/core...",
    );
    assert.equal(
      core.buildCommand,
      "node ../../scripts/ci/vercel-with-pnpm.mjs pnpm vercel-build",
    );
  });
});
