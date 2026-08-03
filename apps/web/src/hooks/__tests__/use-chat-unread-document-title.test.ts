import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useChatUnreadDocumentTitle } from "@/hooks/use-chat-unread-document-title";

describe("useChatUnreadDocumentTitle", () => {
  beforeEach(() => {
    document.title = "Sokosumi";
  });

  afterEach(() => {
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
});
