import { afterEach, describe, expect, it, vi } from "vitest";

const { initCoreLoggerMock } = vi.hoisted(() => ({
  initCoreLoggerMock: vi.fn(),
}));
vi.mock("./evlog.js", () => ({ initCoreLogger: initCoreLoggerMock }));

const STARTED = Symbol.for("sokosumi.core.logger-started");
const scope = globalThis as { [STARTED]?: true };
const startedBefore = scope[STARTED];

afterEach(() => {
  if (startedBefore) scope[STARTED] = startedBefore;
  else delete scope[STARTED];
});

describe("evlog-init", () => {
  it("starts Core's logger once per process, however often it loads", async () => {
    delete scope[STARTED];

    await import("./evlog-init");
    vi.resetModules();
    await import("./evlog-init");

    // A second start would replace the drain a test installed. The test
    // setup's own call, with its silent drain, does not count.
    const starts = initCoreLoggerMock.mock.calls.filter(
      (call) => call.length === 0,
    );
    expect(starts).toHaveLength(1);
  });
});
