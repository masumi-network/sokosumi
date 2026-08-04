import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useChatUnreadDocumentTitle } from "@/hooks/use-chat-unread-document-title";

function getDocumentTitleDescriptor(): {
  descriptor: PropertyDescriptor & {
    get: (this: Document) => string;
    set: (this: Document, value: string) => void;
  };
} {
  let owner: object | null = document;
  while (owner) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, "title");
    if (descriptor?.get && descriptor.set) {
      return {
        descriptor: descriptor as PropertyDescriptor & {
          get: (this: Document) => string;
          set: (this: Document, value: string) => void;
        },
      };
    }
    owner = Object.getPrototypeOf(owner);
  }
  throw new Error("document.title descriptor unavailable");
}

function trackVisibleDocumentTitles(): {
  titles: string[];
  restore: () => void;
} {
  const titles: string[] = [];
  const { descriptor } = getDocumentTitleDescriptor();

  Object.defineProperty(document, "title", {
    configurable: true,
    enumerable: true,
    get() {
      return descriptor.get.call(document);
    },
    set(value: string) {
      descriptor.set.call(document, value);
      titles.push(descriptor.get.call(document));
    },
  });

  return {
    titles,
    restore() {
      Reflect.deleteProperty(document, "title");
    },
  };
}

describe("useChatUnreadDocumentTitle", () => {
  beforeEach(() => {
    document.title = "Sokosumi";
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "title");
    document.title = "";
  });

  it("applies an unread prefix to document.title", () => {
    renderHook(() => useChatUnreadDocumentTitle(3));

    expect(document.title).toBe("(3) Sokosumi");
  });

  it("strips the prefix when unreadTotal becomes 0", () => {
    const { rerender } = renderHook(
      ({ unreadTotal }) => useChatUnreadDocumentTitle(unreadTotal),
      { initialProps: { unreadTotal: 2 } },
    );

    expect(document.title).toBe("(2) Sokosumi");

    rerender({ unreadTotal: 0 });

    expect(document.title).toBe("Sokosumi");
  });

  it("strips the prefix on unmount", () => {
    const { unmount } = renderHook(() => useChatUnreadDocumentTitle(5));

    expect(document.title).toBe("(5) Sokosumi");

    unmount();

    expect(document.title).toBe("Sokosumi");
  });

  it("re-applies the unread prefix after an external title mutation", async () => {
    renderHook(() => useChatUnreadDocumentTitle(2));

    expect(document.title).toBe("(2) Sokosumi");

    await act(async () => {
      document.title = "Room · Sokosumi";
      await Promise.resolve();
    });

    expect(document.title).toBe("(2) Room · Sokosumi");
  });

  it("does not strip the unread prefix between channel navigations when unreadTotal changes", () => {
    const { titles, restore } = trackVisibleDocumentTitles();

    try {
      const { rerender } = renderHook(
        ({ unreadTotal }) => useChatUnreadDocumentTitle(unreadTotal),
        { initialProps: { unreadTotal: 2 } },
      );

      expect(document.title).toBe("(2) Sokosumi");
      titles.length = 0;

      // Channel soft-nav changes activeRoomId → unread room count often shifts.
      rerender({ unreadTotal: 1 });

      expect(titles.some((title) => !/^\(\d+\) /.test(title))).toBe(false);
      expect(document.title).toBe("(1) Sokosumi");
    } finally {
      restore();
    }
  });

  it("does not expose an unprefixed title when soft navigation rewrites metadata", async () => {
    renderHook(() => useChatUnreadDocumentTitle(3));
    expect(document.title).toBe("(3) Sokosumi");

    const { titles, restore } = trackVisibleDocumentTitles();

    try {
      await act(async () => {
        document.title = "Sokosumi - Chat";
        await Promise.resolve();
      });

      expect(titles.length).toBeGreaterThan(0);
      expect(titles.some((title) => !/^\(\d+\) /.test(title))).toBe(false);
      expect(document.title).toBe("(3) Sokosumi - Chat");
    } finally {
      restore();
    }
  });
});
