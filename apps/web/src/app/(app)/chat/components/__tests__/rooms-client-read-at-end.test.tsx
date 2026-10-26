import "./rooms-client-harness";
import type { ChatRoomMessage } from "@sokosumi/core-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomComposerHandle } from "@/app/chat/components/room-composer";
import { getRoomMessageAction } from "@/app/chat/message-actions";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { chatRoomMessageEventDataSchema } from "@/lib/ably/schema";
import { RoomsClient } from "../rooms-client";
import {
  channelRoom,
  listRoomMessagesAction,
  markOrganizationChatRoomReadAction,
  mockReplace,
  mockSearch,
  roomsClientBaseProps,
  sampleMessage,
  useChatRoomRealtimeMock,
} from "./rooms-client-harness";
import { transcriptViewportEnd } from "./transcript-viewport-stub";

const { fetchRoomMessagesMock } = vi.hoisted(() => ({
  fetchRoomMessagesMock: vi.fn(),
}));

vi.mock("@/components/chat/fetch-room-messages", () => ({
  fetchRoomMessages: fetchRoomMessagesMock,
}));

vi.mock("@/app/chat/message-actions", () => ({
  getRoomMessageAction: vi.fn(),
}));

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
  RoomSessionComposer: ({ ref }: { ref?: Ref<RoomComposerHandle> }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return <div data-testid="room-session-composer" />;
  },
}));

// `data-message-id` is what a landing looks for.
vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => (
    <div data-testid="chat-message-row" data-message-id={message.id}>
      {message.content}
    </div>
  ),
}));

const baseProps = roomsClientBaseProps();

function peerMessage(id: string, content: string): ChatRoomMessage {
  return {
    ...sampleMessage(content, id),
    createdAt: new Date("2026-07-01T12:02:00.000Z"),
    sender: {
      type: "user",
      user: {
        id: "user-2",
        name: "Bob",
        email: "bob@example.com",
        image: null,
        presence: "offline",
      },
    },
  };
}

async function deliver(message: ChatRoomMessage) {
  const onMessage = useChatRoomRealtimeMock.mock.calls.at(-1)?.[0].onMessage;
  const event = chatRoomMessageEventDataSchema.parse(
    JSON.parse(JSON.stringify({ eventType: "create", message })),
  );
  await act(async () => onMessage?.(event));
  expect(screen.getByText(message.content)).toBeTruthy();
}

async function reachEnd(atEnd = true) {
  await act(async () => transcriptViewportEnd.report(atEnd));
}

describe("RoomsClient reads a room only at the end of its transcript", () => {
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    clearRoomReadOverlays();
    vi.clearAllMocks();
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
    fetchRoomMessagesMock.mockReset().mockResolvedValue(null);
    vi.mocked(listRoomMessagesAction).mockResolvedValue({
      ok: true,
      value: { messages: [], nextCursor: null },
    });
    vi.mocked(markOrganizationChatRoomReadAction).mockImplementation(
      async (roomId: string) => ({
        ok: true as const,
        value: { ...channelRoom(), id: roomId },
      }),
    );
  });

  it("reads a room whose transcript opens at its end", async () => {
    render(<RoomsClient {...baseProps} messages={[sampleMessage()]} />);
    await waitFor(() => {
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    });
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledWith(
      "room-channel",
    );
  });

  it("does not read a room on open, only once the reader reaches the end", async () => {
    transcriptViewportEnd.openAtEnd = false;
    render(<RoomsClient {...baseProps} messages={[sampleMessage()]} />);
    await act(async () => {});
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();

    await reachEnd();
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledWith(
      "room-channel",
    );
  });

  it("keeps a room unread when the reader leaves before reaching the end", async () => {
    transcriptViewportEnd.openAtEnd = false;
    const view = render(
      <RoomsClient {...baseProps} messages={[sampleMessage()]} />,
    );
    await act(async () => {});

    transcriptViewportEnd.openAtEnd = true;
    const other = { ...channelRoom(), id: "room-other", name: "other" };
    view.rerender(
      <RoomsClient
        {...baseProps}
        rooms={[channelRoom(), other]}
        selectedRoomId="room-other"
        messages={[{ ...sampleMessage("other room"), roomId: "room-other" }]}
      />,
    );
    await waitFor(() => {
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledWith(
        "room-other",
      );
    });
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalledWith(
      "room-channel",
    );
  });

  it("reads messages that arrive while the reader is at the end", async () => {
    render(<RoomsClient {...baseProps} messages={[sampleMessage()]} />);
    await waitFor(() => {
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    });
    vi.mocked(markOrganizationChatRoomReadAction).mockClear();

    await deliver(peerMessage("peer-1", "arrived at the end"));
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
  });

  it("holds messages that arrive while scrolled up until the reader reaches the end", async () => {
    render(<RoomsClient {...baseProps} messages={[sampleMessage()]} />);
    await waitFor(() => {
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    });
    vi.mocked(markOrganizationChatRoomReadAction).mockClear();

    await reachEnd(false);
    await deliver(peerMessage("peer-1", "arrived while scrolled up"));
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();

    await reachEnd();
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
  });

  it("does not read again on reaching the end when nothing new arrived", async () => {
    render(<RoomsClient {...baseProps} messages={[sampleMessage()]} />);
    await waitFor(() => {
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    });
    await reachEnd(false);
    await reachEnd();
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
  });

  it.each(["visibilitychange", "focus"])(
    "reads on %s only when the transcript is at its end",
    async (eventName) => {
      visibility = "hidden";
      transcriptViewportEnd.openAtEnd = false;
      render(<RoomsClient {...baseProps} messages={[sampleMessage()]} />);
      await act(async () => {});

      visibility = "visible";
      await act(async () => {
        if (eventName === "focus") window.dispatchEvent(new Event("focus"));
        else document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();

      await reachEnd();
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    },
  );

  it("reads a room opened on a named message only after the jump, at the end", async () => {
    // The route drops the spent parameter; the stub router has to as well.
    mockReplace.mockImplementation((href: string) => {
      mockSearch.current = href.split("?")[1] ?? "";
    });
    mockSearch.current = "message=msg-old";
    const lookup = Promise.withResolvers<{
      ok: true;
      value: ChatRoomMessage | null;
    }>();
    vi.mocked(getRoomMessageAction).mockReturnValue(lookup.promise);
    const older = sampleMessage("older target", "msg-old");
    vi.mocked(listRoomMessagesAction).mockResolvedValue({
      ok: true,
      value: { messages: [older], nextCursor: null },
    });
    const props = {
      ...baseProps,
      messages: [peerMessage("msg-new", "newest message")],
    };

    // The viewport opens at the end before the jump moves it.
    const view = render(<RoomsClient {...props} />);
    await act(async () => {});
    view.rerender(<RoomsClient {...props} />);
    await act(async () => {});
    expect(getRoomMessageAction).toHaveBeenCalledWith(
      "room-channel",
      "msg-old",
    );
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();

    // Landing on the older target takes the reader off the end.
    await act(async () => lookup.resolve({ ok: true, value: older }));
    await waitFor(() => expect(screen.getByText("older target")).toBeTruthy());
    await act(async () => {});
    expect(
      document
        .querySelector('[data-message-id="msg-old"]')
        ?.getAttribute("data-search-landed"),
    ).toBe("true");
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();

    await reachEnd();
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
  });
});
