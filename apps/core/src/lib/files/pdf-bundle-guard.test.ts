import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
    expect(result.stdout).toContain("pdfjs shipped by includeFiles");
  });

  it("fails when it cannot see the config it guards", () => {
    /**
     * Run from the repository root, `require.resolve` still succeeds —
     * resolution is relative to the script, not the working directory —
     * but there is no `vercel.json` there, so whether the glob covers the
     * parser is unknowable. Unknowable has to fail: a guard that cannot
     * see the file it guards has nothing to say.
     *
     * It also has to fail *without* throwing. An exception here used to
     * bury an otherwise perfectly clear resolution error under a stack
     * trace, which is the same class of problem as the unbound `error`
     * this script shipped once already.
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
    expect(result.stderr).toContain("cannot read vercel.json");
    // Reported, not thrown.
    expect(result.stderr).not.toContain("ENOENT");
    // Both files, not just the entry: pdf.mjs loads the worker from a
    // variable at runtime, so a bundle with only the entry fails one
    // layer deeper with the same symptom.
    expect(result.stderr).toContain("pdf.mjs");
    expect(result.stderr).toContain("pdf.worker.mjs");
  });

  it("names the resolution failure when the dependency is absent", () => {
    /**
     * The branch neither the guard's own runs nor the test above could
     * reach, and it was broken for it.
     *
     * `catch {` binds nothing, so the `error.code` in the message
     * referenced an unbound name and the handler threw a ReferenceError.
     * The build still went red — the gate held — but the operator read a
     * bug in the guard instead of "cannot resolve (MODULE_NOT_FOUND)" at
     * the exact moment they needed the real reason.
     *
     * Nothing caught it because both existing cases resolve successfully:
     * the healthy run finds pdfjs, and the repo-root run still resolves
     * (resolution is relative to the script, not the working directory)
     * and fails on the later project-root check instead. Reaching this
     * branch needs resolution itself to fail.
     *
     * So the script is copied somewhere with no `node_modules` above it
     * and run there. That is a real `MODULE_NOT_FOUND` from a real
     * `require.resolve`, not an assertion about a mocked string — which
     * is the only way this test can tell a working handler from a
     * throwing one.
     */
    const elsewhere = mkdtempSync(`${tmpdir()}/pdfjs-guard-`);
    try {
      const copied = `${elsewhere}/check-pdfjs-bundle.mjs`;
      copyFileSync(SCRIPT, copied);

      /**
       * `NODE_PATH` has to go, and that is not a trick to force the test
       * to pass. pnpm exports it pointing at the workspace store, so a
       * child spawned from a pnpm script resolves `pdfjs-dist` from
       * anywhere on the filesystem — including a temporary directory
       * with no `node_modules` above it. Leaving it set made this test
       * exercise the project-root branch again, which is the branch that
       * was already covered and already worked.
       *
       * Removing it is what a machine without the dependency looks like,
       * which is the situation the guard exists for.
       */
      const { NODE_PATH: _ignored, ...env } = process.env;
      const result = spawnSync(process.execPath, [copied], {
        cwd: elsewhere,
        encoding: "utf8",
        env,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("cannot resolve");
      expect(result.stderr).toContain("MODULE_NOT_FOUND");
      // The failure this test exists for: a handler that throws while
      // reporting the failure it was handling.
      expect(result.stderr).not.toContain("ReferenceError");
      // And both specifiers are reported, not just the first.
      expect(result.stderr).toContain("pdf.mjs");
      expect(result.stderr).toContain("pdf.worker.mjs");
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("fails when vercel.json stops covering the parser", () => {
    /**
     * The hole the rebase onto the Soko Bot sandbox work made reachable.
     *
     * Both sides set `includeFiles` on the same function — ours
     * `node_modules/pdfjs-dist/legacy/build/**`, main's
     * `dist/soko-bot-runner.mjs` — and the position takes a single
     * string, not an array: the schema `vercel.json` points at says
     * `"type": "string"`, maxLength 256, with the array form existing
     * only under `experimentalServices`. So the two share one pattern
     * through brace expansion, and a merge resolution that keeps only
     * one half is an ordinary thing to do by accident.
     *
     * This script used to compare resolved paths against a prefix
     * written down inside itself, so that resolution would have left it
     * green while shipping no parser — the exact silent failure its own
     * docstring is about, one level up. It reads the real pattern now.
     */
    const withoutOurHalf = mkdtempSync(`${tmpdir()}/pdfjs-glob-`);
    try {
      // A tree the script can run in: the real script, the real
      // node_modules symlink, and a vercel.json keeping only main's half.
      const copied = `${withoutOurHalf}/check-pdfjs-bundle.mjs`;
      copyFileSync(SCRIPT, copied);
      symlinkSync(
        path.join(PACKAGE_ROOT, "node_modules"),
        `${withoutOurHalf}/node_modules`,
        "dir",
      );
      const config = JSON.parse(
        readFileSync(path.join(PACKAGE_ROOT, "vercel.json"), "utf8"),
      ) as {
        functions: Record<string, { includeFiles?: string }>;
      };
      config.functions["dist/index.js"].includeFiles =
        "dist/soko-bot-runner.mjs";
      writeFileSync(
        `${withoutOurHalf}/vercel.json`,
        JSON.stringify(config, null, 2),
      );

      const result = spawnSync(process.execPath, [copied], {
        cwd: withoutOurHalf,
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("not matched by the includeFiles glob");
      expect(result.stderr).toContain("pdf.mjs");
      expect(result.stderr).toContain("pdf.worker.mjs");
      // The message has to name the pattern that is actually there, or
      // the operator cannot see what went wrong.
      expect(result.stderr).toContain("dist/soko-bot-runner.mjs");
    } finally {
      rmSync(withoutOurHalf, { recursive: true, force: true });
    }
  });

  it("ships main's file as well as ours", () => {
    /**
     * The other half of the same resolution. Dropping main's entry would
     * break the Soko Bot runner, and nothing in this package would
     * notice — so the pattern is asserted to cover both, here, where the
     * two features meet.
     */
    const config = JSON.parse(
      readFileSync(path.join(PACKAGE_ROOT, "vercel.json"), "utf8"),
    ) as { functions: Record<string, { includeFiles?: string }> };
    const pattern = config.functions["dist/index.js"].includeFiles;

    expect(typeof pattern).toBe("string");
    expect(pattern).toContain("dist/soko-bot-runner.mjs");
    expect(pattern).toContain("node_modules/pdfjs-dist/legacy/build/");
    // Single string at this position, per the schema vercel.json declares.
    expect(Array.isArray(pattern)).toBe(false);
    expect((pattern as string).length).toBeLessThanOrEqual(256);
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
