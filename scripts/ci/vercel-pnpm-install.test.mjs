import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const script = path.join(import.meta.dirname, "vercel-pnpm-install.mjs");

describe("vercel-pnpm-install", () => {
  it("exits with usage when filter is missing", () => {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /usage: vercel-pnpm-install\.mjs/);
  });

  it("is wired as installCommand for web and core", async () => {
    const web = JSON.parse(
      await readFile(path.join(repoRoot, "apps/web/vercel.json"), "utf8"),
    );
    const core = JSON.parse(
      await readFile(path.join(repoRoot, "apps/core/vercel.json"), "utf8"),
    );
    assert.equal(
      web.installCommand,
      'node ../../scripts/ci/vercel-pnpm-install.mjs "web..."',
    );
    assert.equal(
      core.installCommand,
      'node ../../scripts/ci/vercel-pnpm-install.mjs "@sokosumi/core..."',
    );
  });
});
