import { afterEach, describe, expect, it, vi } from "vitest";

const { ssrfSafeFetchMock } = vi.hoisted(() => ({
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import {
  DOCX_QUEUE_WAIT_TIMEOUT_MS,
  DocxExportQueueError,
  withDocxExportLock,
} from "@/lib/utils/docx-export-lock";
import { withDocxExportFetchGuard } from "@/lib/utils/docx-export-ssrf";
import { setupDomContext } from "@/lib/utils/dom-context";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("withDocxExportLock", () => {
  afterEach(() => vi.useRealTimers());

  it("expires a queued callback without running it later", async () => {
    vi.useFakeTimers();
    const hold = deferred<void>();
    const first = withDocxExportLock(() => hold.promise);
    const expired = vi.fn(async () => "expired");
    const waiting = withDocxExportLock(expired);
    const rejection =
      expect(waiting).rejects.toBeInstanceOf(DocxExportQueueError);
    try {
      await vi.advanceTimersByTimeAsync(DOCX_QUEUE_WAIT_TIMEOUT_MS);
      await rejection;
      expect(expired).not.toHaveBeenCalled();
    } finally {
      hold.resolve();
      await first;
    }
    await expect(withDocxExportLock(async () => "next")).resolves.toBe("next");
    expect(expired).not.toHaveBeenCalled();
  });

  it("removes an aborted waiter without blocking the next export", async () => {
    const hold = deferred<void>();
    const first = withDocxExportLock(() => hold.promise);
    const controller = new AbortController();
    const canceled = vi.fn(async () => "canceled");
    const waiting = withDocxExportLock(canceled, controller.signal);
    const rejection =
      expect(waiting).rejects.toBeInstanceOf(DocxExportQueueError);
    const next = withDocxExportLock(async () => "next");
    try {
      controller.abort();
      await rejection;
    } finally {
      hold.resolve();
      await first;
    }
    await expect(next).resolves.toBe("next");
    expect(canceled).not.toHaveBeenCalled();
  });

  it("rejects an already aborted request without starting conversion", async () => {
    const conversion = vi.fn(async () => "unused");
    await expect(
      withDocxExportLock(conversion, AbortSignal.abort()),
    ).rejects.toBeInstanceOf(DocxExportQueueError);
    expect(conversion).not.toHaveBeenCalled();
  });

  it("keeps the lock until active conversion settles after request abort", async () => {
    vi.useFakeTimers();
    const hold = deferred<void>();
    const controller = new AbortController();
    const first = withDocxExportLock(() => hold.promise, controller.signal);
    const next = vi.fn(async () => "next");
    try {
      controller.abort();
      await vi.advanceTimersByTimeAsync(DOCX_QUEUE_WAIT_TIMEOUT_MS);
      const second = withDocxExportLock(next);
      await Promise.resolve();
      expect(next).not.toHaveBeenCalled();
      hold.resolve();
      await first;
      await expect(second).resolves.toBe("next");
    } finally {
      hold.resolve();
      await first;
    }
  });

  it("does not start the next conversion before the previous one settles", async () => {
    const events: string[] = [];
    const first = deferred<void>();

    const a = withDocxExportLock(async () => {
      events.push("a:start");
      await first.promise;
      events.push("a:end");
    });
    const b = withDocxExportLock(async () => {
      events.push("b:start");
    });

    await Promise.resolve();
    expect(events).toEqual(["a:start"]);

    first.resolve();
    await Promise.all([a, b]);
    expect(events).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("runs the next conversion after the previous one throws", async () => {
    await expect(
      withDocxExportLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(withDocxExportLock(async () => "second")).resolves.toBe(
      "second",
    );
  });

  it("keeps each export on its own fetch guard and its own DOM", async () => {
    ssrfSafeFetchMock.mockResolvedValue(new Response("ok"));

    const seen: Record<
      string,
      { fetch: unknown; document: unknown; installed: unknown }
    > = {};
    const firstGuardInstalled = deferred<void>();

    async function exportOnce(
      id: string,
      onGuardInstalled?: () => void,
      waitFor?: Promise<void>,
    ) {
      return withDocxExportLock(async () => {
        const cleanup = await setupDomContext();
        const installed = (global as Record<string, unknown>).document;
        try {
          await withDocxExportFetchGuard(async () => {
            onGuardInstalled?.();
            await waitFor;
            seen[id] = {
              fetch: globalThis.fetch,
              document: (global as Record<string, unknown>).document,
              installed,
            };
          });
        } finally {
          cleanup();
        }
      });
    }

    const b = deferred<void>();
    const first = exportOnce(
      "a",
      () => firstGuardInstalled.resolve(),
      b.promise,
    );
    const second = exportOnce("b");

    await firstGuardInstalled.promise;
    b.resolve();
    await Promise.all([first, second]);

    // Each export observed the guard and the document it installed itself,
    // so neither ran on the other's globals or saw the other's teardown.
    expect(seen.a.fetch).not.toBe(seen.b.fetch);
    expect(seen.a.document).toBe(seen.a.installed);
    expect(seen.b.document).toBe(seen.b.installed);
    expect(seen.a.installed).not.toBe(seen.b.installed);
  });
});
