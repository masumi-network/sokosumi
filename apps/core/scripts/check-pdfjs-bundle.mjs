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
 * actually loads, and it checks them against the glob `vercel.json`
 * actually contains rather than one written down here.
 *
 * That distinction was a real hole. This script used to compare the
 * resolved paths against a prefix string of its own, so a resolution of a
 * `vercel.json` merge conflict that dropped our glob — which is exactly
 * what the Soko Bot sandbox work made possible, since both sides set
 * `includeFiles` on the same function — would have left the guard green
 * while shipping no parser. A guard that does not read the file it is
 * guarding is checking its own opinion.
 */
import { globSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

/** Both of them: pdf.mjs loads the worker from a variable at runtime. */
const SPECIFIERS = [
  "pdfjs-dist/legacy/build/pdf.mjs",
  "pdfjs-dist/legacy/build/pdf.worker.mjs",
];

/** The function key whose `includeFiles` has to cover the parser. */
const FUNCTION_KEY = "dist/index.js";

/**
 * The glob `vercel.json` actually declares, and what it matches.
 *
 * `includeFiles` is a single string at this position — the schema the
 * file itself points at says `"type": "string"`, maxLength 256, and the
 * array form exists only under `experimentalServices`. So when two
 * features both need files shipped, they share one pattern, and the way
 * they share it is brace expansion. Reading and expanding it here is the
 * only way to know our half survived.
 */
function includedFiles(projectRoot) {
  let config;
  try {
    config = JSON.parse(
      readFileSync(path.join(projectRoot, "vercel.json"), "utf8"),
    );
  } catch {
    /**
     * Unreadable rather than crashing, so the resolution checks below
     * still get to report. Whichever of the two is wrong, the operator
     * should see both — an exception here hid a perfectly good
     * "cannot resolve (MODULE_NOT_FOUND)" behind a stack trace.
     */
    return { pattern: null, unreadable: true, matched: new Set() };
  }

  const pattern = config?.functions?.[FUNCTION_KEY]?.includeFiles;
  if (typeof pattern !== "string" || pattern.length === 0) {
    return { pattern: null, unreadable: false, matched: new Set() };
  }
  const matched = new Set(
    globSync(pattern, { cwd: projectRoot }).map((file) =>
      file.replaceAll("\\", "/"),
    ),
  );
  return { pattern, unreadable: false, matched };
}

/** Where the glob has to place the parser, relative to the project root. */
const INCLUDE_DIR = "node_modules/pdfjs-dist/legacy/build/";

const require = createRequire(import.meta.url);
const projectRoot = process.cwd();
const included = includedFiles(projectRoot);
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
   * Resolving is necessary and not sufficient, and the two checks are
   * different questions.
   *
   * `require.resolve` returns the realpath, which under pnpm goes through
   * the content-addressed store and is nowhere near the project root.
   * `includeFiles` never sees that path — it globs under the project
   * root, where pnpm has left a symlink. Comparing the realpath against
   * the glob was this script's own first bug: it failed on a healthy
   * tree.
   *
   * So resolve to prove the dependency is installed, then ask the glob
   * that `vercel.json` really declares whether it matches this file.
   */
  const wanted = `${INCLUDE_DIR}${path.basename(resolved)}`;
  if (!included.matched.has(wanted)) {
    failures.push(
      included.unreadable
        ? `${specifier}: cannot read vercel.json from ${projectRoot}, so ` +
            `whether the glob covers ${wanted} is unknown`
        : included.pattern === null
          ? `${specifier}: vercel.json sets no includeFiles for "${FUNCTION_KEY}"`
          : `${specifier}: ${wanted} is not matched by the includeFiles ` +
            `glob in vercel.json (${included.pattern})`,
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
  `[files] pdfjs shipped by includeFiles: ${SPECIFIERS.length} files ` +
    `matched by ${included.pattern}`,
);
