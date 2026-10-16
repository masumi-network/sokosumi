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
import type { RoomMessagePage } from "../room-messages-hydrator";
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

describe("room open with server-started history", () => {
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    useChatRoomRealtimeMock.mockClear();
    rowMounts.count = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["before", true],
    ["after", false],
  ])(
    "never hides painted rows when the server page resolves %s mount",
    async (_when, resolvedFirst) => {
      const message: ChatRoomMessage = sampleMessage("server history row");
      const page: RoomMessagePage = {
        messages: [message],
        nextCursor: null,
        failed: false,
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                data: [message],
                meta: { pagination: { nextCursor: null } },
              }),
            ),
        ),
      );
      const server = deferred<RoomMessagePage>();
      if (resolvedFirst) server.resolve(page);
      const recorder = recordListStates({ rows: "server history row" });
      render(
        <>
          <a
            href="/chat/rooms/room-channel"
            onClick={(event) => event.preventDefault()}
          >
            Open
          </a>
          <PersistentRoomView>
            <RoomRouteBootstrap
              {...roomsClientBaseProps({
                loadHistoryOnClient: true,
                messagesPromise: server.promise,
              })}
            />
          </PersistentRoomView>
        </>,
        { wrapper: CacheWrapper },
      );
      fireEvent.click(screen.getByText("Open"));
      if (!resolvedFirst) await act(async () => server.resolve(page));
      expect(await screen.findByText("server history row")).toBeTruthy();
      for (let tick = 0; tick < 10; tick++) await act(async () => {});
      recorder.stop();
      const firstRows = recorder.states.indexOf("rows");
      expect(recorder.states.slice(firstRows)).toEqual(["rows"]);
      expect(rowMounts.count).toBe(1);
      // The open's first head read is the page's server read.
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("switches from an open room to a fresh one without flashing", async () => {
    const a = sampleMessage("room A row");
    const b = { ...sampleMessage("room B row"), id: "b1", roomId: "room-b" };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify({
              data: String(url).includes("room-b") ? [b] : [a],
              meta: { pagination: { nextCursor: null } },
            }),
          ),
      ),
    );
    const serverA = deferred<RoomMessagePage>();
    serverA.resolve({ messages: [a], nextCursor: null, failed: false });
    const serverB = deferred<RoomMessagePage>();
    const rosterB = deferred<never>();
    const propsA = roomsClientBaseProps({
      loadHistoryOnClient: true,
      messagesPromise: serverA.promise,
    });
    const propsB = roomsClientBaseProps({
      loadHistoryOnClient: true,
      selectedRoomId: "room-b",
      rooms: [{ ...propsA.rooms[0], id: "room-b", name: "Channel B" }],
      messagesPromise: serverB.promise,
      rosterPromise: rosterB.promise,
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
    const recorder = recordListStates({ A: "room A row", B: "room B row" });
    fireEvent.click(screen.getByText("Open B"));
    view.rerender(<Page bootstrap={propsB} />);
    await act(async () =>
      serverB.resolve({ messages: [b], nextCursor: null, failed: false }),
    );
    expect(await screen.findByText("room B row")).toBeTruthy();
    for (let tick = 0; tick < 10; tick++) await act(async () => {});
    recorder.stop();
    const firstB = recorder.states.indexOf("B");
    expect(recorder.states.slice(firstB)).toEqual(["B"]);
  });
});
