import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { describe, expect, it, vi } from "vitest";

import { type BackHistory, navigateBack } from "./navigate-back";

const ORIGIN = "https://app.example.com";

function fakeRouter() {
  const back = vi.fn();
  const replace = vi.fn();
  const push = vi.fn();
  return {
    router: { back, replace, push } as unknown as AppRouterInstance,
    back,
    replace,
    push,
  };
}

/** History whose last entry is the current page. */
function history(
  ...entries: Array<string | { url: string; sameDocument: boolean }>
): BackHistory {
  const list = entries.map((entry, index) => {
    const { url, sameDocument } =
      typeof entry === "string" ? { url: entry, sameDocument: true } : entry;
    return { key: `k${index}`, url: `${ORIGIN}${url}`, sameDocument };
  });
  return { currentEntry: list.at(-1) ?? null, entries: () => list };
}

describe("navigateBack", () => {
  it("pops back to the parent when the reader came from it", () => {
    const { router, back, replace, push } = fakeRouter();

    navigateBack(router, "/chat", history("/", "/chat", "/chat/rooms/r1"));

    expect(back).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("pops back to the parent whatever its query, when the href names none", () => {
    const { router, back, replace } = fakeRouter();

    navigateBack(router, "/chat", history("/chat?dm=new", "/chat/rooms/r1"));

    expect(back).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });

  it("pops back only to the view the href names", () => {
    const pop = fakeRouter();
    navigateBack(
      pop.router,
      "/newsletter/issues?projectId=a",
      history("/newsletter/issues?projectId=a", "/newsletter/issues/i1"),
    );
    expect(pop.back).toHaveBeenCalledOnce();

    const swap = fakeRouter();
    navigateBack(
      swap.router,
      "/newsletter/issues?projectId=b",
      history("/newsletter/issues?projectId=a", "/newsletter/issues/i1"),
    );
    expect(swap.replace).toHaveBeenCalledWith("/newsletter/issues?projectId=b");
    expect(swap.back).not.toHaveBeenCalled();
  });

  it("swaps the page for its parent when the reader came from elsewhere", () => {
    const { router, back, replace, push } = fakeRouter();

    navigateBack(router, "/chat", history("/", "/chat/rooms/r1"));

    expect(replace).toHaveBeenCalledWith("/chat");
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("swaps the page for its parent when it opened first, from a link or notification", () => {
    const { router, back, replace } = fakeRouter();

    navigateBack(router, "/chat", history("/chat/rooms/r1"));

    expect(replace).toHaveBeenCalledWith("/chat");
    expect(back).not.toHaveBeenCalled();
  });

  it("never pops to a parent loaded as another document", () => {
    const { router, back, replace } = fakeRouter();

    navigateBack(
      router,
      "/chat",
      history({ url: "/chat", sameDocument: false }, "/chat/rooms/r1"),
    );

    expect(replace).toHaveBeenCalledWith("/chat");
    expect(back).not.toHaveBeenCalled();
  });

  it("swaps the page for its parent where the browser has no Navigation API", () => {
    const { router, back, replace } = fakeRouter();

    navigateBack(router, "/chat", undefined);

    expect(replace).toHaveBeenCalledWith("/chat");
    expect(back).not.toHaveBeenCalled();
  });

  it("swaps the page for its parent when the current entry is unknown", () => {
    const { router, back, replace } = fakeRouter();

    navigateBack(router, "/chat", {
      currentEntry: null,
      entries: () => [],
    });

    expect(replace).toHaveBeenCalledWith("/chat");
    expect(back).not.toHaveBeenCalled();
  });
});
