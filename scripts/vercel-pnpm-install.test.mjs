import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  findRepoRoot,
  pnpmBinPath,
  pnpmInstallArgs,
  readPinnedPnpmVersion,
} from "./vercel-pnpm-install.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("vercel pnpm install helper", () => {
  it("resolves the workspace root from apps/web", () => {
    assert.equal(findRepoRoot(path.join(repoRoot, "apps", "web")), repoRoot);
  });

  it("reads the pinned pnpm version from packageManager", async () => {
    const pkg = JSON.parse(
      await readFile(path.join(repoRoot, "package.json"), "utf8"),
    );
    assert.match(pkg.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
    assert.equal(
      readPinnedPnpmVersion(repoRoot),
      pkg.packageManager.slice("pnpm@".length),
    );
  });

  it("installs with frozen lockfile and the given filter", () => {
    assert.deepEqual(pnpmInstallArgs("web..."), [
      "install",
      "--frozen-lockfile",
      "--filter",
      "web...",
    ]);
    assert.deepEqual(pnpmInstallArgs("@sokosumi/core..."), [
      "install",
      "--frozen-lockfile",
      "--filter",
      "@sokosumi/core...",
    ]);
  });

  it("points vercel.json installCommand at this helper, not PATH pnpm", async () => {
    const web = JSON.parse(
      await readFile(path.join(repoRoot, "apps", "web", "vercel.json"), "utf8"),
    );
    const core = JSON.parse(
      await readFile(
        path.join(repoRoot, "apps", "core", "vercel.json"),
        "utf8",
      ),
    );

    assert.equal(
      web.installCommand,
      "node ../../scripts/vercel-pnpm-install.mjs web...",
    );
    assert.equal(
      core.installCommand,
      "node ../../scripts/vercel-pnpm-install.mjs @sokosumi/core...",
    );
    assert.equal(
      pnpmBinPath("/tmp/prefix"),
      path.join("/tmp/prefix", "node_modules", ".bin", "pnpm"),
    );
  });
});
