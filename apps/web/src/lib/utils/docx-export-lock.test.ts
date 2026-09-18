import { describe, expect, it, vi } from "vitest";

const { ssrfSafeFetchMock } = vi.hoisted(() => ({
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import { withDocxExportLock } from "@/lib/utils/docx-export-lock";
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
