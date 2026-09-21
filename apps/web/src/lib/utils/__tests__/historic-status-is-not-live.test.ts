import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/**
 * A status badge that spins claims the work is in flight as you read it. An
 * activity feed renders `event.status`: the status someone set at that moment,
 * which a later event has usually already replaced. The claim is false there.
 *
 * Holding the glyph still was the first fix and it was the wrong one. A
 * stopped `LoaderCircle` is an arc with a gap in it and nothing else, so the
 * whole glyph means motion and at rest it reads as a rendering fault. The
 * historic form is `TaskStatusInline`: a dot, which was never moving, and the
 * status word beside it.
 *
 * Two feeds render this shape today, the task activity feed and the public
 * share view, and the second one was missed when the first was fixed. This
 * catches the third.
 *
 * Scope is deliberately narrow: a badge fed from `event.status` inside a JSX
 * element. A badge fed from `task.status` shows the status now and must keep
 * its spin, so it is not matched here.
 */
const HISTORIC_BADGE = /<TaskStatusBadge\b[\s\S]*?\/>/g;

const EXTENSIONS = new Set([".tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (EXTENSIONS.has(path.extname(name))) out.push(full);
  }
  return out;
}

describe("historic status badges", () => {
  it("never draws a status a later event has replaced as a live badge", () => {
    const violations: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      if (rel.endsWith(".test.tsx")) continue;

      const source = readFileSync(file, "utf8");
      for (const [element] of source.matchAll(HISTORIC_BADGE)) {
        if (!/\bevent\.status\b/.test(element)) continue;
        const line = source
          .slice(0, source.indexOf(element))
          .split("\n").length;
        violations.push(
          `${rel}:${line}: reads event.status; use TaskStatusInline`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * Without this the guard is vacuous: delete both feeds and the regex above
   * matches nothing, which looks exactly like a pass.
   */
  it("still finds the two feeds it exists to police", () => {
    const feeds = walk(SRC_ROOT).filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /<TaskStatusInline\b/.test(source) && /\bevent\.status\b/.test(source)
      );
    });

    expect(feeds.length).toBeGreaterThanOrEqual(2);
  });
});
