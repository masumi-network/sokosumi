#!/usr/bin/env node
/**
 * Fail the build if the PDF parser will not be in the function.
 *
 * The parser reaches the deployed function through exactly one mechanism:
 * the `includeFiles` glob in `apps/core/vercel.json`. Nothing traces it —
 * the child program imports pdfjs from inside a template literal, and
 * `@vercel/nft` does not follow the `createRequire(...).resolve(...)` in
 * `lib/files/pdf.ts` either. Measured, not assumed: zero pdfjs files
 * traced from the source and from the bundle, while static imports in the
 * same harness trace fine.
 *
 * One mechanism is survivable. One *silent* mechanism is not. The glob
 * matches relative to the project root, and evaluated where the pnpm
 * symlink is absent it matches zero files and says nothing. A hoisted
 * install, a `--filter` change, or a pdfjs release that renames
 * `legacy/build/` would all give a green build, green CI, and
 * `parser-unavailable` on every document until somebody noticed — and the
 * user-facing failure is deliberately calm, so noticing takes a while.
 *
 * This turns that into a red build. It checks the two files the parser
 * actually loads, at the paths the glob has to cover.
 */
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

/** Both of them: pdf.mjs loads the worker from a variable at runtime. */
const SPECIFIERS = [
  "pdfjs-dist/legacy/build/pdf.mjs",
  "pdfjs-dist/legacy/build/pdf.worker.mjs",
];

/** What vercel.json claims will be shipped. */
const INCLUDE_GLOB_PREFIX = "node_modules/pdfjs-dist/legacy/build/";

const require = createRequire(import.meta.url);
const projectRoot = process.cwd();
const failures = [];

for (const specifier of SPECIFIERS) {
  let resolved;
  try {
    resolved = require.resolve(specifier);
  } catch (error) {
    // Bound, and it has to stay bound. A lint fix for the *other* catch
    // below — which genuinely does not use its error — was applied with a
    // pattern that matched both, and this line then referenced an unbound
    // name. The guard still failed the build, so the gate held, but the
    // operator read "ReferenceError: error is not defined" instead of
    // "cannot resolve (MODULE_NOT_FOUND)" at the one moment they need the
    // real reason.
    failures.push(
      `${specifier}: cannot resolve (${/** @type {NodeJS.ErrnoException} */ (error).code ?? "unknown"})`,
    );
    continue;
  }

  try {
    if (!statSync(resolved).isFile()) {
      failures.push(`${specifier}: resolved to ${resolved}, not a file`);
      continue;
    }
  } catch {
    failures.push(`${specifier}: resolved to ${resolved}, cannot stat`);
    continue;
  }

  /**
   * Resolving is necessary and not sufficient, and the two checks have to
   * be kept apart.
   *
   * `require.resolve` returns the realpath, which under pnpm goes through
   * the content-addressed store — `../../node_modules/.pnpm/pdfjs-dist@…`
   * — and is nowhere near the project root. `includeFiles` does not see
   * that path. It globs under the project root, where pnpm has left a
   * symlink, and it is the symlinked path that has to exist.
   *
   * Checking the realpath against the glob prefix was this script's own
   * first bug: it failed on a perfectly good tree. So resolve to prove
   * the dependency is installed and satisfiable, then stat the glob's own
   * path to prove the glob has something to match.
   */
  const globbed = path.join(
    projectRoot,
    INCLUDE_GLOB_PREFIX,
    path.basename(resolved),
  );
  try {
    if (!statSync(globbed).isFile()) {
      failures.push(
        `${specifier}: ${INCLUDE_GLOB_PREFIX}${path.basename(resolved)} is not a file`,
      );
    }
  } catch {
    failures.push(
      `${specifier}: resolves to ${resolved}, but ` +
        `${INCLUDE_GLOB_PREFIX}${path.basename(resolved)} does not exist ` +
        `under the project root — the includeFiles glob in vercel.json ` +
        `would match nothing`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    "\nThe PDF parser would not be present in the deployed function.\n",
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "\nEvery PDF would extract as UNSUPPORTED with reason " +
      "'parser-unavailable', quietly, on every document.\n" +
      "Fix the dependency or the includeFiles glob in " +
      "apps/core/vercel.json; do not delete this check.\n",
  );
  process.exit(1);
}

console.log(
  `[files] pdfjs present for includeFiles: ${SPECIFIERS.length} files ` +
    `under ${INCLUDE_GLOB_PREFIX}`,
);
