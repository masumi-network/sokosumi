import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRoomReadReceipts } from "@/app/chat/hooks/use-room-read-receipts";
import type {
  ChatRoom,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    key === "transcript" ? `Seen by ${values?.count}` : key,
}));

import { RoomSeenByLine } from "./room-seen-by-line";

const VIEWER_ID = "user-viewer";
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
  } as ChatRoomUserParticipant;
}

/**
 * Drives the line through the real receipts hook: what a reader sees under
 * the newest message is the hook's arithmetic, not a number a test made up.
 */
function Probe({
  members,
  isNewest = true,
  createdAt = NEWEST_AT,
}: {
  members: ChatRoomUserParticipant[];
  isNewest?: boolean;
  createdAt?: string;
}) {
  const room = {
    id: "room-1",
    userMembers: members,
    coworkerMembers: [],
    sokoBotMembers: [],
  } as unknown as ChatRoom;
  const receipts = useRoomReadReceipts({ room, currentUserId: VIEWER_ID });
  return (
    <RoomSeenByLine
      countReadAsOf={receipts.countReadAsOf}
      createdAt={createdAt}
      isNewest={isNewest}
    />
  );
}

function line() {
  return screen.queryByTestId("room-seen-by-line");
}

describe("RoomSeenByLine", () => {
  it("counts the members whose mark has passed the message", () => {
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

    expect(line()).toHaveTextContent("Seen by 2");
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

    expect(line()).toHaveTextContent("Seen by 1");
  });

  it("renders nothing under a message that is not the newest", () => {
    render(
      <Probe
        isNewest={false}
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
