import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const agentIdDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(join(agentIdDir, rel), "utf8");
}

/**
 * Full-bleed zeroes `main`'s padding so the jobs panes can stick. On the
 * agent profile it left no gutter between 768px and the max-w-4xl column,
 * and put the page's Find field under the phone top bar.
 */
describe("agent profile keeps the app gutter", () => {
  it("does not turn on full-bleed for the profile", () => {
    expect(read("layout.tsx")).not.toMatch(/AgentFullbleedEffect|fullbleed/);
  });

  it("turns on full-bleed for the jobs screens", () => {
    const jobsLayout = read("jobs/layout.tsx");
    expect(jobsLayout).toContain("<AgentFullbleedEffect />");
    expect(jobsLayout).toContain("data-agent-fullbleed");
  });
});
