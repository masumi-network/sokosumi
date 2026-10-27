import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    relativeTime: () => "now",
    dateTime: () => "",
  }),
}));

// Core answers from the reader's read state: once the room has been read,
// nothing is unread and the summary comes back empty.
const core = vi.hoisted(() => ({ roomRead: false }));

vi.mock("@/app/chat/signal-actions", () => ({
  getChatRoomCatchUpAction: async () => ({
    ok: true,
    value: {
      buckets: [{ bucket: "needsYou", count: 1, messageIds: ["m1"] }],
    },
  }),
}));

function summaryEnvelope() {
  return {
    data: {
      scope: "room",
      unreadTaggedCount: core.roomRead ? 0 : 1,
      counts: core.roomRead ? [] : [{ bucket: "needsYou", count: 1 }],
      headline: core.roomRead ? null : "Albina needs a call on the launch.",
      rooms: [],
      generatedAt: null,
      needsYou: [],
      decisions: [],
      openLoops: [],
      highlights: [],
    },
    meta: { timestamp: "2026-10-27T21:00:00.000Z", requestId: "r-1" },
  };
}

import { RoomCatchUpLine } from "./room-catch-up-line";

function renderLine() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RoomCatchUpLine
        roomId="room-1"
        unreadAtOpen={8}
        onJump={async () => true}
      />
    </QueryClientProvider>,
  );
}

describe("RoomCatchUpLine", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    core.roomRead = false;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => Response.json(summaryEnvelope()));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("writes the summary of what was unread when the room opened, not after it was read", async () => {
    renderLine();
    await screen.findByTestId("room-catch-up-line");

    core.roomRead = true;
    fireEvent.click(screen.getByTestId("room-summary-trigger"));

    expect(
      await screen.findByText("Albina needs a call on the launch."),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat/room-1/summary");
  });

  it("says the reader is caught up when the summary has nothing in it", async () => {
    core.roomRead = true;
    renderLine();
    await screen.findByTestId("room-catch-up-line");

    fireEvent.click(screen.getByTestId("room-summary-trigger"));

    expect(await screen.findByTestId("chat-caught-up")).toBeTruthy();
  });
});
