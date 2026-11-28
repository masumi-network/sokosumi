import "./rooms-client-harness";
import type { ChatRoomMessage } from "@sokosumi/core-client";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Ref, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PendingRoomQuote } from "../room-helpers";
import type { RoomSessionComposerHandle } from "../room-session-composer";
import {
  channelRoom,
  createRoomsClient,
  mockPathname,
  mockReplace,
  mockSearch,
  renderWithQueryClient,
  sampleMessage,
  userParticipant,
} from "./rooms-client-harness";

const { openDirectWithParticipantMock, focusAtEndMock } = vi.hoisted(() => ({
  openDirectWithParticipantMock: vi.fn(),
  focusAtEndMock: vi.fn(),
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
    ref?: Ref<RoomSessionComposerHandle>;
    pendingQuote?: PendingRoomQuote | null;
  }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
      focusAtEnd: focusAtEndMock,
      addText: () => undefined,
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

function openDirectNavigates() {
  openDirectWithParticipantMock.mockImplementation(
    async (options: { router: { push: (href: string) => void } }) => {
      options.router.push("/chat/rooms/room-dm");
      return { ok: true, roomId: "room-dm" };
    },
  );
}

/** Renders the channel, picks Reply privately, then lands on `arrival`. */
async function replyThenArrive(arrival: { search: string }) {
  openDirectNavigates();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(
    "11111111-1111-4111-8111-111111111111",
  );
  const user = userEvent.setup();
  const props = { rooms: [channel, direct], messages: [graceMessage()] };
  const view = renderWithQueryClient(createRoomsClient(props));

  await user.click(
    await screen.findByRole("button", { name: "reply privately msg-grace" }),
  );
  expect(openDirectWithParticipantMock).toHaveBeenCalledWith(
    expect.objectContaining({
      profile: expect.objectContaining({ kind: "human", id: "user-2" }),
    }),
  );

  mockPathname.mockImplementation(() => "/chat/rooms/room-dm");
  mockSearch.current = arrival.search;
  await act(async () => {
    view.rerender(
      createRoomsClient({ ...props, selectedRoomId: "room-dm", messages: [] }),
    );
  });
}

describe("Reply privately", () => {
  it("opens the author's Direct with the channel message quoted", async () => {
    await replyThenArrive({
      search: "reply=11111111-1111-4111-8111-111111111111",
    });

    expect(screen.getByTestId("room-session-composer")).toHaveTextContent(
      "quote:Grace:room-channel",
    );
    // The request is taken off the URL, so a reload does not ask again.
    expect(mockReplace).toHaveBeenCalledWith("/chat/rooms/room-dm", {
      scroll: false,
    });
    // The caret goes after any draft already in the Direct, not before it.
    await waitFor(() => {
      expect(focusAtEndMock).toHaveBeenCalled();
    });
  });

  it("leaves the Direct alone when the navigation that carried the quote never arrives", async () => {
    // Reply privately was picked, but the reader went elsewhere first and
    // opens the Direct later on their own, without the request.
    await replyThenArrive({ search: "" });

    expect(screen.getByTestId("room-session-composer")).toHaveTextContent(
      "no quote",
    );
    expect(focusAtEndMock).not.toHaveBeenCalled();
  });

  it("is not offered for a former member of a private Channel", async () => {
    renderWithQueryClient(
      createRoomsClient({
        rooms: [
          channelRoom({
            discoverability: "private",
            userMembers: [userParticipant("user-1", "Ada")],
          }),
          direct,
        ],
        messages: [graceMessage()],
      }),
    );

    expect(await screen.findByText("msg-grace")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reply privately/ }),
    ).not.toBeInTheDocument();
  });

  it("is offered for a former member of a public Channel, who can still read it", async () => {
    renderWithQueryClient(
      createRoomsClient({
        rooms: [
          channelRoom({
            discoverability: "public",
            userMembers: [userParticipant("user-1", "Ada")],
          }),
          direct,
        ],
        messages: [graceMessage()],
      }),
    );

    expect(
      await screen.findByRole("button", { name: "reply privately msg-grace" }),
    ).toBeInTheDocument();
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
