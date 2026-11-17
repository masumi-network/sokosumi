import {
  aroundEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import {
  checkConsoleUntouched,
  expectConsole,
  installConsoleGuard,
} from "./test-console";

// Core and Web install the guard from their Vitest setup files; this package
// has none, so its self-test installs it here.
installConsoleGuard();

describe("console guard", () => {
  it("lets console.log through", () => {
    console.log("console guard: console.log stays allowed");
  });

  it("consumes exactly the declared calls", () => {
    expectConsole("warn", "declared warning", 2);
    expectConsole("error", /^declared error \d+/);
    console.warn("declared warning", { detail: 1 });
    console.warn("declared warning again");
    console.error("declared error 42");
  });

  it("matches a library logger's message after its colored prefix", () => {
    expectConsole("warn", /^\S+ WARN \[Library\]: rejected/);
    console.warn(
      "\u001b[2m2026-01-01T00:00:00.000Z\u001b[0m WARN [Library]: rejected",
    );
  });

  it("returns the matched calls' arguments", () => {
    const calls = expectConsole("warn", "method check");
    console.warn("method check", { id: 1 });
    expect(calls).toEqual([["method check", { id: 1 }]]);
  });

  it("refuses an unanchored pattern", () => {
    expect(() => expectConsole("warn", /anywhere/)).toThrow("anchor");
  });

  it.fails("fails a test that writes an undeclared console.error", () => {
    console.error(
      "console guard: undeclared error (this test is expected to fail)",
    );
  });

  it.fails("fails a test that writes an undeclared console.warn", () => {
    console.warn(
      "console guard: undeclared warning (this test is expected to fail)",
    );
  });

  it.fails("fails a message that only contains the declared text", () => {
    expectConsole("warn", "declared");
    console.warn("console guard: not declared (expected to fail)");
  });

  it.fails("fails a second call where one is declared", () => {
    expectConsole("warn", "once");
    console.warn("once");
    console.warn("once more (this test is expected to fail)");
  });

  it.fails("fails a test whose declared message never comes", () => {
    expectConsole("error", "never written");
  });

  it.fails("matches the method, not only the message", () => {
    expectConsole("warn", "method check");
    console.error("method check (this test is expected to fail)");
  });

  it.fails("fails a test that mocks console.error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.fails("fails a plain replacement restored within the test", () => {
    const saved = console.warn;
    console.warn = () => {};
    console.warn("console guard: muted (this test is expected to fail)");
    console.warn = saved;
  });

  it.fails("fails a plain replacement left installed", () => {
    console.error = () => {};
  });

  it("puts the guard back after a replacement was left installed", () => {
    const calls = expectConsole("error", "routed through the guard");
    console.error("routed through the guard");
    expect(calls).toHaveLength(1);
  });

  it.fails("does not let ^ match after a newline (m flag)", () => {
    expectConsole("warn", /^declared/m);
    console.warn("unexpected prefix\ndeclared (this test is expected to fail)");
  });

  it.fails("does not let an unanchored alternative match later", () => {
    expectConsole("warn", /^declared|other/);
    console.warn("unexpected prefix, other (this test is expected to fail)");
  });

  it.fails("fails a bare mock assigned and left installed", () => {
    console.warn = vi.fn();
    console.warn("console guard: lost (this test is expected to fail)");
  });

  it("puts the guard back after a bare mock was left installed", () => {
    const calls = expectConsole("warn", "routed after a bare mock");
    console.warn("routed after a bare mock");
    expect(calls).toHaveLength(1);
  });

  it.fails("fails a temporary withImplementation", () => {
    const spy = vi.spyOn(console, "warn");
    spy.withImplementation(
      () => {},
      () => console.warn("console guard: lost (this test is expected to fail)"),
    );
    spy.mockRestore();
  });

  it.fails("fails a temporary descriptor replacement", () => {
    const saved = Object.getOwnPropertyDescriptor(console, "warn");
    Object.defineProperty(console, "warn", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    if (saved) Object.defineProperty(console, "warn", saved);
  });

  it("reports a replacement made outside a test at the file's end", () => {
    // What a file's afterAll does: the same check, before anything is cleared.
    const saved = console.error;
    console.error = () => {};
    console.error = saved;
    expect(() => checkConsoleUntouched("outside a test in this file")).toThrow(
      "replaced console output",
    );
  });

  it.fails("fails a test that mocks console.warn and restores it", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    console.warn("console guard: muted (this test is expected to fail)");
    spy.mockRestore();
  });

  // The next two run in order: the first leaves a spy with a changed
  // implementation behind, which vi.restoreAllMocks() does not take off.
  it.fails("fails a mocked console.error spy, then restoreAllMocks", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.restoreAllMocks();
  });

  it.fails("still fails undeclared console.error in the test after it", () => {
    console.error(
      "console guard: undeclared after a mocked spy (this test is expected to fail)",
    );
  });

  it.fails("fails a mocked console.warn spy, then restoreAllMocks", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.restoreAllMocks();
  });

  it.fails("still fails undeclared console.warn in the test after it", () => {
    console.warn(
      "console guard: undeclared after a mocked spy (this test is expected to fail)",
    );
  });

  it("lets a spy that only watches through", () => {
    const calls = expectConsole("warn", "watched");
    const spy = vi.spyOn(console, "warn");
    console.warn("watched");
    expect(spy).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(1);
    spy.mockRestore();
  });
});

describe("console guard: the console object", () => {
  const guarded = console;

  it.fails("fails a console swapped and put back within the test", () => {
    const saved = globalThis.console;
    globalThis.console = { ...saved, warn: vi.fn(), error: vi.fn() };
    console.warn("console guard: lost (this test is expected to fail)");
    globalThis.console = saved;
  });

  it.fails("fails a console swap left installed", () => {
    globalThis.console = { ...console, warn: vi.fn(), error: vi.fn() };
  });

  it("puts the guarded console back after a swap was left installed", () => {
    expect(globalThis.console).toBe(guarded);
    const calls = expectConsole("warn", "routed after a console swap");
    console.warn("routed after a console swap");
    expect(calls).toHaveLength(1);
  });
});

// Vitest runs these after afterEach. Each pair runs in order: the first
// replaces a method in its cleanup, the second must start guarded.
describe("console guard: cleanup after afterEach", () => {
  it.fails("fails a replacement made in onTestFinished", () => {
    onTestFinished(() => {
      console.warn = () => {};
    });
  });

  it("starts the next test guarded after onTestFinished", () => {
    const calls = expectConsole("warn", "routed after onTestFinished");
    console.warn("routed after onTestFinished");
    expect(calls).toHaveLength(1);
  });

  describe("returned from beforeEach", () => {
    let first = true;
    beforeEach(() => {
      if (!first) return;
      first = false;
      return () => {
        console.error = () => {};
      };
    });

    it.fails("fails a replacement made in beforeEach's cleanup", () => {});

    it("starts the next test guarded after beforeEach's cleanup", () => {
      const calls = expectConsole("error", "routed after beforeEach cleanup");
      console.error("routed after beforeEach cleanup");
      expect(calls).toHaveLength(1);
    });
  });
});

// Vitest 5.1.0 runs aroundEach teardown after the guard's per-test check, so
// the guard first sees a replacement there when the next test starts.
describe("console guard: aroundEach teardown", () => {
  let first = true;
  let routed = false;
  aroundEach(async (runTest) => {
    await runTest();
    if (!first) return;
    first = false;
    console.warn = () => {};
  });

  // The limit: nothing in Vitest runs after this teardown to fail this test.
  it("passes, its aroundEach teardown running after the check", () => {});

  it.fails("fails the next test, naming the one before it", () => {
    const calls = expectConsole("warn", "routed after aroundEach teardown");
    console.warn("routed after aroundEach teardown");
    routed = calls.length === 1;
  });

  it("ran that next test guarded", () => {
    expect(routed).toBe(true);
  });
});

// Vitest 5.1.0 tears down the fixtures an aroundEach uses after every hook,
// so the guard first sees a replacement there when the next test starts.
describe("console guard: teardown of a fixture aroundEach uses", () => {
  let first = true;
  let routed = false;
  const fixtureTest = it.extend<{ muting: undefined }>({
    muting: async ({ task: _task }, use) => {
      await use(undefined);
      if (!first) return;
      first = false;
      console.error = () => {};
    },
  });
  fixtureTest.aroundEach(async (runTest, { muting: _muting }) => {
    await runTest();
  });

  // The limit: nothing in Vitest runs after this teardown to fail this test.
  fixtureTest("passes, its fixture teardown running after the check", () => {});

  fixtureTest.fails("fails the next test, naming the one before it", () => {
    const calls = expectConsole("error", "routed after fixture teardown");
    console.error("routed after fixture teardown");
    routed = calls.length === 1;
  });

  fixtureTest("ran that next test guarded", () => {
    expect(routed).toBe(true);
  });
});

// A test cancelled with skip() is reported skipped and Vitest drops its
// errors, so what it or a test before it left is reported by the next test
// that runs. Each block runs in order.
describe("console guard: undeclared output, then skips", () => {
  it("writes undeclared output, then skips", ({ skip }) => {
    console.error(
      "console guard: undeclared before a skip (a later test is expected to fail)",
    );
    skip();
  });

  it("skips again", ({ skip }) => skip());

  it.fails("reports it at the next test that runs", () => {});
});

describe("console guard: a replacement, then skips", () => {
  it("replaces console.warn, then skips", ({ skip }) => {
    console.warn = () => {};
    skip();
  });

  it("skips again", ({ skip }) => skip());

  it.fails("reports it at the next test that runs", () => {});
});

describe("console guard: a late violation, then a skip", () => {
  let first = true;
  const fixtureTest = it.extend<{ resource: number }>({
    resource: async ({ task: _task }, use) => {
      await use(1);
      if (!first) return;
      first = false;
      console.error(
        "console guard: undeclared in a late teardown (a later test is expected to fail)",
      );
    },
  });
  fixtureTest.aroundEach(async (runTest, { resource: _resource }) => {
    await runTest();
  });

  fixtureTest("leaves output in a late teardown", () => {});

  fixtureTest("skips", ({ skip }) => skip());

  fixtureTest.fails("reports it at the next test that runs", () => {});
});

// Automatic fixtures tear down inside the test, before the guard checks it.
describe("console guard: automatic fixtures", () => {
  describe("declared output in teardown", () => {
    const autoTest = it.extend<{ resource: number }>({
      resource: [
        async ({ task: _task }, use) => {
          await use(1);
          console.warn("declared in an automatic fixture's teardown");
        },
        { auto: true },
      ],
    });

    autoTest("counts for the test that declared it", () => {
      expectConsole("warn", "declared in an automatic fixture's teardown");
    });
  });

  describe("undeclared output in teardown", () => {
    let first = true;
    const autoTest = it.extend<{ resource: number }>({
      resource: [
        async ({ task: _task }, use) => {
          await use(1);
          if (!first) return;
          first = false;
          console.error(
            "console guard: undeclared in an automatic fixture's teardown (expected to fail)",
          );
        },
        { auto: true },
      ],
    });

    autoTest.fails("fails the test whose fixture wrote it", () => {});

    autoTest("leaves the next test clean", () => {});
  });

  describe("a replacement in teardown, then the next setup", () => {
    let first = true;
    let routed = -1;
    const autoTest = it.extend<{ resource: number }>({
      resource: [
        async ({ task: _task }, use) => {
          if (!first) {
            const calls = expectConsole("warn", "routed in fixture setup");
            console.warn("routed in fixture setup");
            routed = calls.length;
          }
          await use(1);
          if (!first) return;
          first = false;
          console.warn = () => {};
        },
        { auto: true },
      ],
    });

    autoTest.fails("fails the test whose fixture replaced it", () => {});

    autoTest("guards the next fixture's setup", () => {
      expect(routed).toBe(1);
    });
  });
});
