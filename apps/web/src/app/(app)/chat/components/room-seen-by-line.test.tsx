import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRoomReadReceipts } from "@/app/chat/hooks/use-room-read-receipts";
import type {
  ChatRoom,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    key === "summary" ? `Seen by ${values?.count} people` : key,
}));

import { RoomSeenByLine, seenByReadersFor } from "./room-seen-by-line";

const VIEWER_ID = "user-viewer";
const NEWEST_ID = "message-newest";
const NEWEST_AT = "2026-01-01T12:00:00.000Z";

function member(
  id: string,
  lastReadAt: string | null,
): ChatRoomUserParticipant {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    image: null,
    presence: "offline",
    access: "member",
    lastReadAt: lastReadAt ? new Date(lastReadAt) : null,
  };
}

/**
 * Drives the line through the real receipts hook: what a reader sees under
 * the newest message is the hook's arithmetic, not a number a test made up.
 */
function Probe({
  members,
  messageId = NEWEST_ID,
  createdAt = NEWEST_AT,
}: {
  members: ChatRoomUserParticipant[];
  messageId?: string;
  createdAt?: string;
}) {
  // Only what the hook reads, but checked against the real DTO so a rename
  // breaks here rather than sliding past a cast.
  const partialRoom: Partial<ChatRoom> = {
    id: "room-1",
    myAccess: "member",
    userMembers: members,
    coworkerMembers: [],
    sokoBotMembers: [],
  };
  const room = partialRoom as ChatRoom;
  const receipts = useRoomReadReceipts({ room, currentUserId: VIEWER_ID });
  const readers = seenByReadersFor({
    readersAsOf: receipts.readersAsOf,
    messageId,
    createdAt,
    newestMessageId: NEWEST_ID,
  });
  return <RoomSeenByLine readers={readers} />;
}

function line() {
  return screen.queryByTestId("room-seen-by-line");
}

describe("RoomSeenByLine", () => {
  it("shows a face per member whose mark has passed the message", () => {
    render(
      <Probe
        members={[
          member("user-a", "2026-01-01T13:00:00.000Z"),
          member("user-b", "2026-01-01T12:30:00.000Z"),
          member("user-c", "2026-01-01T11:00:00.000Z"),
          member("user-d", null),
        ]}
      />,
    );

    expect(line()).toHaveAccessibleName("Seen by 2 people");
    expect(screen.getByTestId("read-receipt-face-user-a")).toBeInTheDocument();
    expect(screen.getByTestId("read-receipt-face-user-b")).toBeInTheDocument();
    expect(
      screen.queryByTestId("read-receipt-face-user-c"),
    ).not.toBeInTheDocument();
  });

  it("caps the faces and counts the rest into a +N", () => {
    render(
      <Probe
        members={[
          member("user-a", "2026-01-01T17:00:00.000Z"),
          member("user-b", "2026-01-01T16:00:00.000Z"),
          member("user-c", "2026-01-01T15:00:00.000Z"),
          member("user-d", "2026-01-01T14:00:00.000Z"),
          member("user-e", "2026-01-01T13:00:00.000Z"),
        ]}
      />,
    );

    expect(line()).toHaveAccessibleName("Seen by 5 people");
    expect(line()).toHaveTextContent("+2");
    expect(
      screen.queryByTestId("read-receipt-face-user-d"),
    ).not.toBeInTheDocument();
  });

  it("leaves the viewer out of the count", () => {
    render(
      <Probe
        members={[
          member(VIEWER_ID, "2026-01-01T13:00:00.000Z"),
          member("user-a", "2026-01-01T13:00:00.000Z"),
        ]}
      />,
    );

    expect(line()).toHaveAccessibleName("Seen by 1 people");
    expect(
      screen.queryByTestId(`read-receipt-face-${VIEWER_ID}`),
    ).not.toBeInTheDocument();
  });

  it("renders nothing on a message that is not the newest", () => {
    render(
      <Probe
        messageId="message-older"
        members={[member("user-a", "2026-01-01T13:00:00.000Z")]}
      />,
    );

    expect(line()).not.toBeInTheDocument();
  });

  it("renders nothing when nobody has read that far", () => {
    render(<Probe members={[member("user-a", "2026-01-01T11:00:00.000Z")]} />);

    expect(line()).not.toBeInTheDocument();
  });

  it("renders nothing when the room carries no read state at all", () => {
    render(<Probe members={[member("user-a", null)]} />);

    expect(line()).not.toBeInTheDocument();
  });
});
