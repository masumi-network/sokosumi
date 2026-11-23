import type { DataRoomEvents } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchDataRoomEvents: vi.fn(),
}));
vi.mock("@/lib/utils/data-room.client", () => api);
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "Nov 23, 2026" }),
}));

import { driveQueryKeys, invalidateDrive } from "@/queries/drive";
import { DataRoomActivity } from "./data-room-activity";

const store = { scope: "org" as const, organizationId: "org_1" };

describe("DataRoomActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keys events under the Drive store prefix and disables Load more while page 1 refreshes", async () => {
    const refreshDeferred = Promise.withResolvers<DataRoomEvents>();
    api.fetchDataRoomEvents
      .mockResolvedValueOnce({
        events: [
          {
            id: "ev_1",
            kind: "view",
            createdAt: "2026-11-23T08:00:00.000Z",
            memberId: null,
            name: "Alice",
            email: "alice@example.com",
            path: "Deck.pdf",
          },
        ],
        nextBefore: "cursor_2",
      })
      .mockImplementationOnce(() => refreshDeferred.promise);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <DataRoomActivity
          store={store}
          roomId="room_1"
          members={[]}
          rows={[]}
        />
      </QueryClientProvider>,
    );

    const loadMore = await screen.findByRole("button", { name: "more" });
    expect(loadMore).toBeEnabled();
    expect(
      client.getQueryData(
        driveQueryKeys.dataRoomEvents(store, "room_1", "everyone"),
      ),
    ).toBeDefined();

    // Triggering a Drive invalidation refreshes page 1: Load more must be disabled.
    const invalidation = invalidateDrive(client, store);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "more" })).toBeDisabled();
    });

    await act(async () => {
      refreshDeferred.resolve({
        events: [
          {
            id: "ev_1",
            kind: "view",
            createdAt: "2026-11-23T08:00:00.000Z",
            memberId: null,
            name: "Alice",
            email: "alice@example.com",
            path: "Deck.pdf",
          },
        ],
        nextBefore: "cursor_2",
      });
      await invalidation;
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "more" })).toBeEnabled();
    });
  });
});
