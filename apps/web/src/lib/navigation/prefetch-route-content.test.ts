import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_CONTENT_RELOADS,
  prefetchRouteContent,
} from "./prefetch-route-content";

/** Records each load and drops all of them, as `router.refresh()` does. */
function fakeRouter() {
  let listeners: Array<() => void> = [];
  const prefetch = vi.fn(
    (_href: string, options?: { onInvalidate?: () => void }) => {
      if (options?.onInvalidate) listeners.push(options.onInvalidate);
    },
  );
  const refresh = () => {
    const dropped = listeners;
    listeners = [];
    for (const listener of dropped) listener();
  };
  return {
    router: { prefetch } as unknown as AppRouterInstance,
    prefetch,
    refresh,
  };
}

describe("prefetchRouteContent", () => {
  it("loads the page again after a refresh drops it, while asked to keep it", () => {
    const { router, prefetch, refresh } = fakeRouter();
    let keep = true;

    prefetchRouteContent(router, "/tasks", { keepLoaded: () => keep });
    refresh();
    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(prefetch).toHaveBeenLastCalledWith(
      "/tasks",
      expect.objectContaining({ kind: "full" }),
    );

    keep = false;
    refresh();
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it("stops after a few reloads, so a polling page cannot render it forever", () => {
    const { router, prefetch, refresh } = fakeRouter();

    prefetchRouteContent(router, "/tasks", { keepLoaded: () => true });
    for (let poll = 0; poll < MAX_CONTENT_RELOADS + 2; poll++) refresh();

    expect(prefetch).toHaveBeenCalledTimes(1 + MAX_CONTENT_RELOADS);
  });

  it("loads once when nothing asks to keep it", () => {
    const { router, prefetch, refresh } = fakeRouter();

    prefetchRouteContent(router, "/tasks");
    refresh();

    expect(prefetch).toHaveBeenCalledOnce();
  });
});
