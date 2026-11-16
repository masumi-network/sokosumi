import "./rooms-client-harness";
import { act, render, screen } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/query-provider";
import {
  PersistentRoomView,
  RoomRouteBootstrap,
} from "../persistent-room-view";
import { RoomCacheProvider } from "../room-cache-provider";
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
});
