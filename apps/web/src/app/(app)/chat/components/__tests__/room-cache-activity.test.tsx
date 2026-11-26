import "./rooms-client-harness";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomTranscriptEntry } from "@/app/chat/utils/room-transcript-cache";
import {
  listenForNavigationStart,
  notifyNavigationStart,
} from "@/lib/navigation/navigation-start";
import { chatQueryKeys } from "@/queries/chat";
import { TestQueryProvider } from "@/test/query-provider";
import {
  PersistentRoomView,
  RoomRouteBootstrap,
} from "../persistent-room-view";
import { RoomCacheProvider } from "../room-cache-provider";
import { RoomsClient } from "../rooms-client";
import { roomsClientBaseProps, sampleMessage } from "./rooms-client-harness";

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => null,
}));
vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: () => null,
}));
vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: () => <div data-testid="room-session-composer" />,
}));
vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({ message }: { message: { content: string } }) => (
    <div>{message.content}</div>
  ),
}));
vi.mock("../thread-panel", () => ({ ThreadPanel: () => null }));
vi.mock("../add-room-members-dialog", () => ({
  AddRoomMembersDialog: () => null,
}));

/**
 * Next keeps the app shell in a hidden Activity while a flow outside it is
 * open (Soko Bot setup's connect step). Hiding runs the room cache's cleanup;
 * the room the flow then opens must still paint.
 */
function Shell({ mode, room }: { mode: "visible" | "hidden"; room: boolean }) {
  return (
    <Activity mode={mode}>
      <TestQueryProvider>
        <RoomCacheProvider currentUserId="user-1" workspaceId="org-1">
          {room ? (
            <PersistentRoomView>
              <RoomRouteBootstrap
                {...roomsClientBaseProps({ loadHistoryOnClient: true })}
              />
            </PersistentRoomView>
          ) : null}
        </RoomCacheProvider>
      </TestQueryProvider>
    </Activity>
  );
}

describe("room cache across a hidden app shell", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("paints a room opened as the shell comes back", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [sampleMessage("welcome row")],
              meta: { pagination: { nextCursor: null } },
            }),
          ),
      ),
    );
    const view = render(<Shell mode="visible" room={false} />);
    view.rerender(<Shell mode="hidden" room={false} />);
    view.rerender(<Shell mode="visible" room />);
    for (let tick = 0; tick < 5; tick++) await act(async () => {});

    expect(await screen.findByText("welcome row")).toBeTruthy();
  });

  it("tells the navigation bar that a click opens a room it already paints", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [sampleMessage("welcome row")],
              meta: { pagination: { nextCursor: null } },
            }),
          ),
      ),
    );
    render(<Shell mode="visible" room />);
    expect(await screen.findByText("welcome row")).toBeTruthy();
    const started = vi.fn();
    const stopListening = listenForNavigationStart(started);
    const link = (path: string) => {
      const anchor = document.createElement("a");
      anchor.href = path;
      document.body.append(anchor);
      return anchor;
    };

    try {
      fireEvent.click(link("/chat/rooms/room-channel"));
      notifyNavigationStart("/chat/rooms/room-channel");
      expect(started).toHaveBeenLastCalledWith(
        "/chat/rooms/room-channel",
        true,
      );

      fireEvent.click(link("/chat/rooms/room-not-cached"));
      notifyNavigationStart("/chat/rooms/room-not-cached");
      expect(started).toHaveBeenLastCalledWith(
        "/chat/rooms/room-not-cached",
        false,
      );
    } finally {
      stopListening();
    }
  });

  it("renders only top-level rows without mutating the retained cache or parent state during render", () => {
    const root = sampleMessage("root message", "msg-root");
    const leakedReply = {
      ...sampleMessage("leaked reply", "msg-reply"),
      parentMessageId: root.id,
      createdAt: new Date("2026-07-01T12:02:00.000Z"),
    };
    const props = roomsClientBaseProps();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
        mutations: { gcTime: Number.POSITIVE_INFINITY },
      },
    });
    const key = chatQueryKeys.transcript(
      { userId: "user-1", workspaceId: "org-1" },
      "room-channel",
    );
    const entry: RoomTranscriptEntry = {
      bootstrap: props,
      transcript: {
        messages: [root, leakedReply],
        rangeEdges: [{ time: root.createdAt.getTime(), id: root.id }],
        oldestHasMore: false,
      },
      resolved: true,
      failed: false,
      dirtyIds: [],
      revision: 0,
      lifetime: {},
    };
    queryClient.setQueryData(key, entry);

    render(
      <QueryClientProvider client={queryClient}>
        <RoomCacheProvider currentUserId="user-1" workspaceId="org-1">
          <RoomsClient {...props} />
        </RoomCacheProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByText("root message")).toBeTruthy();
    expect(screen.queryByText("leaked reply")).toBeNull();
    expect(queryClient.getQueryData<RoomTranscriptEntry>(key)?.revision).toBe(
      0,
    );
  });
});
