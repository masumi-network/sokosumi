import "./rooms-client-harness";
import type { ChatRoomMessage } from "@sokosumi/core-client";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Ref, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RoomComposerHandle } from "../room-composer";
import type { PendingRoomQuote } from "../room-helpers";
import {
  channelRoom,
  createRoomsClient,
  renderWithQueryClient,
  sampleMessage,
  userParticipant,
} from "./rooms-client-harness";

const { openDirectWithParticipantMock } = vi.hoisted(() => ({
  openDirectWithParticipantMock: vi.fn(),
}));

vi.mock("../open-direct-with-participant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../open-direct-with-participant")>()),
  openDirectWithParticipant: openDirectWithParticipantMock,
}));

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => null,
}));

vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: () => null,
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: ({
    ref,
    pendingQuote,
  }: {
    ref?: Ref<RoomComposerHandle>;
    pendingQuote?: PendingRoomQuote | null;
  }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return (
      <div data-testid="room-session-composer">
        {pendingQuote
          ? `quote:${pendingQuote.authorName}:${pendingQuote.roomId ?? ""}`
          : "no quote"}
      </div>
    );
  },
}));

vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({
    message,
    onReplyPrivately,
  }: {
    message: ChatRoomMessage;
    onReplyPrivately?: (message: ChatRoomMessage) => void;
  }) =>
    onReplyPrivately ? (
      <button type="button" onClick={() => onReplyPrivately(message)}>
        reply privately {message.id}
      </button>
    ) : (
      <div>{message.id}</div>
    ),
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: () => null,
}));

const grace = userParticipant("user-2", "Grace");

function graceMessage(): ChatRoomMessage {
  return {
    ...sampleMessage("Can we move the launch?", "msg-grace"),
    sender: { type: "user", user: grace },
  };
}

const channel = channelRoom({
  userMembers: [userParticipant("user-1", "Ada"), grace],
});
const direct = channelRoom({
  id: "room-dm",
  kind: "direct",
  slug: null,
  discoverability: null,
  userMembers: [userParticipant("user-1", "Ada"), grace],
});

describe("Reply privately", () => {
  it("opens the author's Direct with the channel message quoted", async () => {
    openDirectWithParticipantMock.mockResolvedValue({
      ok: true,
      roomId: "room-dm",
    });
    const user = userEvent.setup();
    const props = {
      rooms: [channel, direct],
      messages: [graceMessage()],
    };
    const view = renderWithQueryClient(createRoomsClient(props));

    await user.click(
      await screen.findByRole("button", { name: "reply privately msg-grace" }),
    );
    expect(openDirectWithParticipantMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ kind: "human", id: "user-2" }),
      }),
    );

    await act(async () => {
      view.rerender(
        createRoomsClient({
          ...props,
          selectedRoomId: "room-dm",
          messages: [],
        }),
      );
    });

    expect(screen.getByTestId("room-session-composer")).toHaveTextContent(
      "quote:Grace:room-channel",
    );
  });

  it("is not offered in a Direct", async () => {
    renderWithQueryClient(
      createRoomsClient({
        rooms: [direct],
        selectedRoomId: "room-dm",
        messages: [{ ...graceMessage(), roomId: "room-dm" }],
      }),
    );

    expect(await screen.findByText("msg-grace")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reply privately/ }),
    ).not.toBeInTheDocument();
  });
});
