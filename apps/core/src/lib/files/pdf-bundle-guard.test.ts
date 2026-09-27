import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The guard that stands between a packaging mistake and a silent feature.
 *
 * `pdfjs-dist` reaches the deployed function through exactly one
 * mechanism: the `includeFiles` glob in `apps/core/vercel.json`. Nothing
 * traces it. The child program imports pdfjs from inside a template
 * literal, and `@vercel/nft` does not follow the
 * `createRequire(...).resolve(...)` in `pdf.ts` either — measured at zero
 * traced files from both the source and the bundle, while a static import
 * in the same harness traces fine.
 *
 * One mechanism is survivable; one *silent* mechanism is not. The glob
 * matches relative to the project root, and where the pnpm symlink is
 * absent it matches zero files and raises nothing. A hoisted install, a
 * `--filter` change or a pdfjs release renaming `legacy/build/` all give a
 * green build, green CI and `parser-unavailable` on every document — and
 * the user-facing failure is deliberately calm, so nobody would notice
 * quickly.
 *
 * So the guard has to fail loudly, and this is what checks that it does.
 * It runs the real script rather than reimplementing its logic, because a
 * reimplementation would pass while the script was broken.
 */

const PACKAGE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const SCRIPT = path.join(PACKAGE_ROOT, "scripts", "check-pdfjs-bundle.mjs");

function run(cwd: string) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });
}

describe("the pdfjs packaging guard", () => {
  it("passes where the glob has something to match", () => {
    const result = run(PACKAGE_ROOT);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("pdfjs present for includeFiles");
  });

  it("fails where the glob would match nothing", () => {
    /**
     * The hoisted-install shape, and the one a `statSync` on the resolved
     * path would miss. From the repository root `require.resolve` still
     * succeeds — resolution is relative to the script, not the working
     * directory — but `node_modules/pdfjs-dist/` does not exist there, so
     * `includeFiles` would ship nothing.
     *
     * This distinction is the script's own first bug, in the other
     * direction: it compared the *resolved realpath* against the glob
     * prefix, and under pnpm that path goes through the content-addressed
     * store and never matches. It failed on a healthy tree.
     */
    expect(
      existsSync(path.join(REPO_ROOT, "node_modules", "pdfjs-dist")),
      "this test assumes pnpm has not hoisted pdfjs to the repository " +
        "root; if it has, the scenario below is no longer the one described",
    ).toBe(false);

    const result = run(REPO_ROOT);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("would not be present");
    expect(result.stderr).toContain("parser-unavailable");
    // Both files, not just the entry: pdf.mjs loads the worker from a
    // variable at runtime, so a bundle with only the entry fails one
    // layer deeper with the same symptom.
    expect(result.stderr).toContain("pdf.mjs");
    expect(result.stderr).toContain("pdf.worker.mjs");
  });

  it("is wired into the build, not merely present", () => {
    // A guard nothing runs is a comment.
    const manifest = JSON.parse(
      readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(manifest.scripts["vercel-build"]).toContain(
      "check-pdfjs-bundle.mjs",
    );
  });
});
