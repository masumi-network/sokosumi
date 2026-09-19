import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  JOBS_PANES_ATTRIBUTE,
  JOBS_TWO_PANE_MIN_WIDTH,
} from "@/app/agents/[agentId]/jobs/components/use-jobs-two-pane-fit";

const JOBS_DIR = join(process.cwd(), "src/app/(app)/agents/[agentId]/jobs");

function read(relativePath: string) {
  return readFileSync(join(JOBS_DIR, relativePath), "utf8");
}

/**
 * The CSS and the JS answer the same question — "do two panes fit?" — from two
 * mechanisms that cannot see each other: a container query and a
 * `ResizeObserver`. If they disagree, the right pane and the modal both show,
 * or neither does. This locks them to one width.
 */
describe("jobs two-pane threshold", () => {
  it("matches the container-query variant the layout uses", () => {
    // Tailwind's `@4xl` container size is 56rem.
    expect(JOBS_TWO_PANE_MIN_WIDTH).toBe(56 * 16);
    expect(read("layout.tsx")).toContain("@4xl/jobs-panes:flex-row");
  });

  it("marks the row the hook measures", () => {
    expect(read("layout.tsx")).toContain(JOBS_PANES_ATTRIBUTE);
  });

  it("names the container the variants query", () => {
    // Without `@container` on the row the `@4xl/jobs-panes` variants never
    // match and the layout is stuck in one column.
    expect(read("layout.tsx")).toContain("@container/jobs-panes");
  });

  it("keeps the panes free of fixed positioning at md and up", () => {
    // `container-type` implies `contain: layout`, which makes the row the
    // containing block for fixed descendants. The jobs header is the one fixed
    // element under the panes and it is `md:hidden`, where the row is not yet a
    // container.
    expect(read("components/header.tsx")).toContain("md:hidden");
  });
});
