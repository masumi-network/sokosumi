import { describe, expect, it, vi } from "vitest";

import { checkConsoleUntouched, expectConsole } from "./console";

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
