import "./rooms-client-harness";
import type { ChatRoomMessage } from "@sokosumi/core-client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/query-provider";
import {
  PersistentRoomView,
  RoomRouteBootstrap,
} from "../persistent-room-view";
import { RoomCacheProvider } from "../room-cache-provider";
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
});
