/**
 * The PostgreSQL files that do not pass on the split layout yet:
 * `split-layout-pending.txt`. CI's split job runs every other file and lets
 * Vitest's exit code decide (`SPLIT_LAYOUT_RUN=must-pass`), then runs only the
 * listed ones (`SPLIT_LAYOUT_RUN=pending`) and checks with
 * `scripts/split-layout-pending.mts` that each of them still fails.
 */

/** One test file of the pending run: its path from `apps/core`, and whether it failed. */
export interface FileResult {
  file: string;
  failed: boolean;
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

/** What the pending run got wrong; empty when every listed file ran and failed. */
export function pendingProblems(
  results: readonly FileResult[],
  pending: ReadonlyMap<string, number>,
): string[] {
  const problems: string[] = [];
  const ran = new Set(results.map((result) => result.file));
  for (const { file, failed } of results) {
    const ticket = pending.get(file);
    if (ticket === undefined) {
      problems.push(`${file} ran in the pending run but is not listed.`);
    } else if (!failed) {
      problems.push(
        `${file} passes on the split layout: remove it from split-layout-pending.txt (ticket ${ticket}).`,
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
  return file.replace(/[[\]{}()*?!+@]/g, "\\$&");
}
