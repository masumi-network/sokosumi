import type { ChatFeed } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useChatFeed } from "./use-chat-feed";

vi.mock("@/components/chat/fetch-chat-feed", () => ({
  fetchChatFeed: vi.fn(() => new Promise(() => {})),
}));

function page(unreadCount: number): ChatFeed {
  return { items: [], nextCursor: null, unreadCount };
}

describe("useChatFeed", () => {
  it("starts a later visit from the server's new first page, not the old cache", async () => {
    // The app's freshness window: cached pages count as fresh for a minute.
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 60 * 1000 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const scope = { currentUserId: "user-1", organizationId: "org-1" };

    const first = renderHook(
      () => useChatFeed({ ...scope, initialPage: page(3) }),
      { wrapper },
    );
    expect(first.result.current.data?.pages[0]?.unreadCount).toBe(3);
    first.unmount();
    await waitFor(() =>
      expect(client.getQueryCache().getAll()).toHaveLength(0),
    );

    const second = renderHook(
      () => useChatFeed({ ...scope, initialPage: page(1) }),
      { wrapper },
    );
    expect(second.result.current.data?.pages[0]?.unreadCount).toBe(1);
  });
});
