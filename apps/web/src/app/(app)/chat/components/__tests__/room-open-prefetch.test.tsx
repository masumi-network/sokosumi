import "./rooms-client-harness";
import type { ChatRoomMessage } from "@sokosumi/core-client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ForesightManager } from "js.foresight";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROOM_APPROACH_REUSE_MS } from "@/app/chat/utils/room-transcript-cache";
import { makeRoom } from "@/components/chat/__tests__/chat-room-fixtures";
import {
  clearMembershipVisibleRoomsSnapshot,
  publishMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import { approachElement } from "@/test/approach-element";
import { TestQueryProvider } from "@/test/query-provider";
import {
  PersistentRoomView,
  RoomRouteBootstrap,
} from "../persistent-room-view";
import {
  RoomCacheProvider,
  useRoomIntentPrefetch,
} from "../room-cache-provider";
import {
  roomsClientBaseProps,
  sampleMessage,
  useChatRoomRealtimeMock,
} from "./rooms-client-harness";

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
const rowMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("../room-message-row", async () => {
  const { useEffect } = await import("react");
  return {
    ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => {
      useEffect(() => {
        rowMounts.count++;
      }, []);
      return <div data-testid="chat-message-row">{message.content}</div>;
    },
  };
});
vi.mock("../thread-panel", () => ({ ThreadPanel: () => null }));
vi.mock("../add-room-members-dialog", () => ({
  AddRoomMembersDialog: () => null,
}));

function CacheWrapper({ children }: { children: ReactNode }) {
  return (
    <TestQueryProvider>
      <RoomCacheProvider currentUserId="user-1" workspaceId="org-1">
        {children}
      </RoomCacheProvider>
    </TestQueryProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Every distinct state the message list shows, in order. */
function recordListStates(labels: Record<string, string>) {
  const states: string[] = [];
  const read = () =>
    Object.entries(labels).find(([, text]) => screen.queryByText(text))?.[0] ??
    (screen.queryByTestId("room-message-list-skeleton") ? "skeleton" : "other");
  const push = () => {
    const state = read();
    if (states.at(-1) !== state) states.push(state);
  };
  push();
  const observer = new MutationObserver(push);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  return { states, stop: () => observer.disconnect() };
}

describe("room open read started on click", () => {
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    useChatRoomRealtimeMock.mockClear();
    rowMounts.count = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearMembershipVisibleRoomsSnapshot();
  });

  it("reads history once, from the click, and fills the list without flashing", async () => {
    const a = sampleMessage("room A row");
    const b = { ...sampleMessage("room B row"), id: "b1", roomId: "room-b" };
    const historyB = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("room-b")
          ? historyB.promise
          : new Response(
              JSON.stringify({
                data: [a],
                meta: { pagination: { nextCursor: null } },
              }),
            ),
      ),
    );
    const propsA = roomsClientBaseProps({ loadHistoryOnClient: true });
    // What the room page passes since history left it: no messages, no promise.
    const propsB = roomsClientBaseProps({
      loadHistoryOnClient: true,
      selectedRoomId: "room-b",
      rooms: [{ ...propsA.rooms[0], id: "room-b", name: "Channel B" }],
    });
    function Page({ bootstrap }: { bootstrap: typeof propsA }) {
      return (
        <>
          <a
            href="/chat/rooms/room-channel"
            onClick={(e) => e.preventDefault()}
          >
            Open A
          </a>
          <a href="/chat/rooms/room-b" onClick={(e) => e.preventDefault()}>
            Open B
          </a>
          <PersistentRoomView>
            <RoomRouteBootstrap {...bootstrap} />
          </PersistentRoomView>
        </>
      );
    }
    const view = render(<Page bootstrap={propsA} />, { wrapper: CacheWrapper });
    fireEvent.click(screen.getByText("Open A"));
    expect(await screen.findByText("room A row")).toBeTruthy();
    for (let tick = 0; tick < 5; tick++) await act(async () => {});
    const roomBReads = () =>
      vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).includes("room-b")).length;
    const recorder = recordListStates({ A: "room A row", B: "room B row" });

    fireEvent.click(screen.getByText("Open B"));
    // The read starts before the route has rendered room B at all.
    expect(roomBReads()).toBe(1);
    view.rerender(<Page bootstrap={propsB} />);
    await act(async () =>
      historyB.resolve(
        new Response(
          JSON.stringify({
            data: [b],
            meta: { pagination: { nextCursor: null } },
          }),
        ),
      ),
    );
    expect(await screen.findByText("room B row")).toBeTruthy();
    for (let tick = 0; tick < 10; tick++) await act(async () => {});
    recorder.stop();

    expect(roomBReads()).toBe(1);
    expect(recorder.states.slice(recorder.states.indexOf("B"))).toEqual(["B"]);
  });

  it("starts the read when the reader heads for the room, and the click takes it", async () => {
    const b = { ...sampleMessage("room B row"), id: "b1", roomId: "room-b" };
    const historyB = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => historyB.promise),
    );
    const propsB = roomsClientBaseProps({
      loadHistoryOnClient: true,
      selectedRoomId: "room-b",
      rooms: [
        { ...roomsClientBaseProps().rooms[0], id: "room-b", name: "Channel B" },
      ],
    });
    function OpenB() {
      return (
        <a
          href="/chat/rooms/room-b"
          onClick={(e) => e.preventDefault()}
          ref={useRoomIntentPrefetch("/chat/rooms/room-b", true)}
        >
          Open B
        </a>
      );
    }
    function Page({ open }: { open: boolean }) {
      return (
        <>
          <OpenB />
          {open ? (
            <PersistentRoomView>
              <RoomRouteBootstrap {...propsB} />
            </PersistentRoomView>
          ) : null}
        </>
      );
    }
    const view = render(<Page open={false} />, { wrapper: CacheWrapper });
    expect(fetch).not.toHaveBeenCalled();

    const link = screen.getByText("Open B");
    await act(() => approachElement(link));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("room-b");

    // An approach the cap turned down must be able to try again this soon.
    expect(
      ForesightManager.instance.registeredElements.get(link)?.reactivateAfter,
    ).toBe(ROOM_APPROACH_REUSE_MS);

    fireEvent.click(link);
    view.rerender(<Page open />);
    await act(async () =>
      historyB.resolve(
        new Response(
          JSON.stringify({
            data: [b],
            meta: { pagination: { nextCursor: null } },
          }),
        ),
      ),
    );
    expect(await screen.findByText("room B row")).toBeTruthy();
    for (let tick = 0; tick < 10; tick++) await act(async () => {});

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("starts both reads for an approach to a room that opens at its Unread divider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Promise<Response>(() => {})),
    );
    publishMembershipVisibleRooms(
      [makeRoom({ id: "room-b", unreadCount: 3, channelUnreadCount: 3 })],
      "org-1",
      "user-1",
    );
    function OpenB() {
      return (
        <a
          href="/chat/rooms/room-b"
          ref={useRoomIntentPrefetch("/chat/rooms/room-b", true)}
        >
          Open B
        </a>
      );
    }
    render(<OpenB />, { wrapper: CacheWrapper });

    await act(() => approachElement(screen.getByText("Open B")));

    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(2);
    expect(
      urls.filter((url) => url.includes("openAtUnread=true")),
    ).toHaveLength(1);
  });
});
