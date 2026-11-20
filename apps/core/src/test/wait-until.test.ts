import { describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

import { waitUntil } from "@vercel/functions";
import { emitCoreWarning } from "@/lib/evlog";
import { expectCoreLog } from "./core-log";
import { drainWaitUntil, expectBackgroundRejection } from "./wait-until";

/** Settles on a later macrotask, after the drain has started awaiting it. */
function later<T>(settle: () => T): Promise<Awaited<T>> {
  return new Promise((resolve, reject) =>
    setImmediate(async () => {
      try {
        resolve(await settle());
      } catch (error) {
        reject(error);
      }
    }),
  );
}

/** Rejections Node reports as unhandled during the current test. */
function watchUnhandledRejections(): unknown[] {
  const reasons: unknown[] = [];
  const listener = (reason: unknown) => reasons.push(reason);
  process.on("unhandledRejection", listener);
  onTestFinished(() => {
    process.off("unhandledRejection", listener);
  });
  return reasons;
}

/** A child that rejects at once, while its parent stays pending a turn longer. */
function parentWithRejectingChild(message: string): Promise<void> {
  return later(async () => {
    waitUntil(Promise.reject(new Error(message)));
    await later(() => undefined);
  });
}

describe("drainWaitUntil", () => {
  it("fails on a rejection nobody declared, also one after the drain began", async () => {
    waitUntil(later(() => Promise.reject(new Error("queue down"))));

    expect(await drainWaitUntil()).toEqual([
      "Undeclared background rejections:\nqueue down",
    ]);
  });

  it("hands a declared rejection back and does not fail on it", async () => {
    const rejections = expectBackgroundRejection("blob down");
    waitUntil(later(() => Promise.reject(new Error("blob down: 503"))));

    expect(await drainWaitUntil()).toEqual([]);
    expect(rejections).toEqual([new Error("blob down: 503")]);
  });

  it("fails when a declared rejection comes another number of times", async () => {
    expectBackgroundRejection("ably down");
    waitUntil(later(() => undefined));

    expect(await drainWaitUntil()).toEqual([
      "Expected background rejections came another number of times:\nably down (expected 1, got 0)",
    ]);
  });

  it("awaits work that registered while the drain awaited the first batch", async () => {
    const warnings = expectCoreLog("warn", "Nested background work warned");
    // The sync handler's shape: its background sync hands reconcileTurn to waitUntil.
    waitUntil(
      later(() => {
        waitUntil(
          later(() =>
            emitCoreWarning(
              { operation: "wait_until_test" },
              { message: "Nested background work warned" },
            ),
          ),
        );
      }),
    );

    expect(await drainWaitUntil()).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("stops and reports a test that keeps registering work", async () => {
    let stopped = false;
    const register = (): Promise<void> =>
      later(() => {
        if (!stopped) waitUntil(register());
      });
    waitUntil(register());

    expect(await drainWaitUntil()).toEqual([
      "Background work kept handing new work to waitUntil after 100 rounds",
    ]);
    // End the chain: the drain after this test awaits its last link.
    stopped = true;
  });

  it("observes a nested rejection before its parent finishes, when declared", async () => {
    const unhandled = watchUnhandledRejections();
    const rejections = expectBackgroundRejection("nested child failed");
    waitUntil(parentWithRejectingChild("nested child failed"));

    expect(await drainWaitUntil()).toEqual([]);
    expect(rejections).toEqual([new Error("nested child failed")]);
    expect(unhandled).toEqual([]);
  });

  it("reports an undeclared nested rejection once, not as unhandled", async () => {
    const unhandled = watchUnhandledRejections();
    waitUntil(parentWithRejectingChild("nested child failed"));

    expect(await drainWaitUntil()).toEqual([
      "Undeclared background rejections:\nnested child failed",
    ]);
    expect(unhandled).toEqual([]);
  });

  it("awaits work registered after a drain and a cleared mock", async () => {
    waitUntil(later(() => undefined));
    expect(await drainWaitUntil()).toEqual([]);
    vi.mocked(waitUntil).mockClear();
    // As many calls as before the clear: a count would call them drained.
    waitUntil(later(() => Promise.reject(new Error("after the clear"))));

    expect(await drainWaitUntil()).toEqual([
      "Undeclared background rejections:\nafter the clear",
    ]);
  });
});

describe("expectBackgroundRejection", () => {
  it("matches a global RegExp on every rejection, as expectConsole does", async () => {
    const rejections = expectBackgroundRejection(/^blob/g, 2);
    waitUntil(later(() => Promise.reject(new Error("blob down"))));
    waitUntil(later(() => Promise.reject(new Error("blob gone"))));

    expect(await drainWaitUntil()).toEqual([]);
    expect(rejections).toHaveLength(2);
  });

  it("matches only at the start of the message", async () => {
    expectBackgroundRejection(/^blob|failure/);
    waitUntil(later(() => Promise.reject(new Error("unrelated blob failure"))));

    expect(await drainWaitUntil()).toEqual([
      "Undeclared background rejections:\nunrelated blob failure",
      "Expected background rejections came another number of times:\n/^blob|failure/ (expected 1, got 0)",
    ]);
  });

  it("refuses an unanchored RegExp", () => {
    expect(() => expectBackgroundRejection(/blob/)).toThrow(
      "anchor the message pattern with ^",
    );
  });
});
