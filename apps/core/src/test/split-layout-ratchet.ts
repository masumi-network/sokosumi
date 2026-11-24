/**
 * The ratchet of the PostgreSQL run on the split layout. `split-layout-pending.txt`
 * lists the files that do not pass there yet, each with the ticket that fixes
 * it. Every other file must pass, and a listed file that passes must leave
 * the list, so the list only shrinks. `scripts/split-layout-ratchet.mts`
 * applies it to Vitest's JSON report.
 */

/** One test file of the run: its path from `apps/core`, and whether it failed. */
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

/** What breaks the ratchet; empty when the run keeps it. */
export function ratchetProblems(
  results: readonly FileResult[],
  pending: ReadonlyMap<string, number>,
): string[] {
  const problems: string[] = [];
  const ran = new Set(results.map((result) => result.file));
  for (const { file, failed } of results) {
    const ticket = pending.get(file);
    if (failed && ticket === undefined) {
      problems.push(
        `${file} fails on the split layout. Fix it, or list it with the ticket that will.`,
      );
    }
    if (!failed && ticket !== undefined) {
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
