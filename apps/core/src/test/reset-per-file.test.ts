import { describe, expect, it } from "vitest";

// Files share a worker (`reset-per-file.ts`); whichever file ran before this
// one, evlog's process-wide config must be back to a fresh process's.
describe("reset-per-file", () => {
  it("starts each file on a fresh evlog config", () => {
    const config = (
      globalThis as Record<symbol, { config: Record<string, unknown> }>
    )[Symbol.for("evlog.registry.v2")]?.config;

    expect(config).toMatchObject({
      initialized: false,
      drain: undefined,
      silent: false,
    });
  });
});
