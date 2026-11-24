import { readFileSync } from "node:fs";

/**
 * The PostgreSQL files that do not pass on the split layout yet:
 * `split-layout-pending.txt`. CI's split job runs every other file and lets
 * Vitest's exit code decide (`SPLIT_LAYOUT_RUN=must-pass`), then runs only the
 * listed ones (`SPLIT_LAYOUT_RUN=pending`) and checks with
 * `scripts/split-layout-pending.mts` that each of them still fails.
 */

/** One test file of the pending run: its path from `apps/core`, and Vitest's file status. */
export interface FileResult {
  file: string;
  status: string;
}

/** Each line is `<path from apps/core> <ticket number>`; `#` starts a comment. */
export function parsePending(text: string): Map<string, number> {
  const pending = new Map<string, number>();
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.replace(/#.*/, "").trim();
    if (line === "") continue;
    const [file, ticket, ...rest] = line.split(/\s+/);
    if (!file || !/^\d+$/.test(ticket ?? "") || rest.length > 0) {
      throw new Error(
        `split-layout-pending.txt line ${index + 1}: expected "<file> <ticket>"`,
      );
    }
    if (pending.has(file)) {
      throw new Error(`split-layout-pending.txt lists ${file} twice`);
    }
    pending.set(file, Number(ticket));
  }
  return pending;
}

/** What the pending run got wrong; empty when every listed file ran with the status `failed`. */
export function pendingProblems(
  results: readonly FileResult[],
  pending: ReadonlyMap<string, number>,
): string[] {
  const problems: string[] = [];
  const ran = new Set(results.map((result) => result.file));
  for (const { file, status } of results) {
    const ticket = pending.get(file);
    if (ticket === undefined) {
      problems.push(`${file} ran in the pending run but is not listed.`);
    } else if (status === "passed") {
      problems.push(
        `${file} passes on the split layout: remove it from split-layout-pending.txt (ticket ${ticket}).`,
      );
    } else if (status !== "failed") {
      problems.push(
        `${file} has the status ${JSON.stringify(status)}, neither failed nor passed.`,
      );
    }
  }
  for (const [file, ticket] of pending) {
    if (!ran.has(file)) {
      problems.push(
        `${file} is listed (ticket ${ticket}) but did not run: remove or rename the entry.`,
      );
    }
  }
  return problems;
}

/** A list entry as a glob that matches exactly that file (`[id]` is literal). */
export function literalGlob(file: string): string {
  return file.replace(/[\\[\]{}()*?!+@]/g, "\\$&");
}

/**
 * True in a PostgreSQL run on the new layout: a real database and three
 * different schema names, none `public` or blank.
 */
export function isSplitLayout(env: NodeJS.ProcessEnv): boolean {
  const names = [
    env.DATABASE_SCHEMA_SHARED,
    env.DATABASE_SCHEMA_MAINNET,
    env.DATABASE_SCHEMA_PREPROD,
  ];
  return (
    env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
    Boolean(env.DATABASE_URL?.startsWith("postgres")) &&
    new Set(names).size === names.length &&
    names.every((name) => name && name !== "public")
  );
}

/**
 * For `vitest.config.ts` in CI's split job (`SPLIT_LAYOUT_RUN`): the listed
 * files as globs. Refuses an unknown run and a run off the split layout, so a
 * Preprod test cannot skip there. Imports only `node:fs`: the config loads this
 * file natively and only in that job.
 */
export function splitLayoutPendingGlobs(
  run: string,
  env: NodeJS.ProcessEnv,
): string[] {
  if (run !== "must-pass" && run !== "pending") {
    throw new Error(
      `SPLIT_LAYOUT_RUN must be must-pass or pending, not ${run}`,
    );
  }
  if (!isSplitLayout(env)) {
    throw new Error(
      "SPLIT_LAYOUT_RUN is set, but this run is not on the split layout: it needs RUN_DATABASE_INTEGRATION_TESTS=true, a PostgreSQL DATABASE_URL and three different DATABASE_SCHEMA_* names, none public.",
    );
  }
  const text = readFileSync(
    new URL("./split-layout-pending.txt", import.meta.url),
    "utf8",
  );
  return [...parsePending(text).keys()].map(literalGlob);
}
