import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
  getChatCatchUpSummaryAction: async () => ({
    ok: true,
    value: {
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
  }),
}));

import { RoomCatchUpLine } from "./room-catch-up-line";

describe("RoomCatchUpLine", () => {
  it("writes the summary of what was unread when the room opened, not after it was read", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RoomCatchUpLine
          roomId="room-1"
          unreadAtOpen={8}
          onJump={async () => true}
        />
      </QueryClientProvider>,
    );
    await screen.findByTestId("room-catch-up-line");

    core.roomRead = true;
    fireEvent.click(screen.getByTestId("room-summary-trigger"));

    expect(
      await screen.findByText("Albina needs a call on the launch."),
    ).toBeTruthy();
  });
});
