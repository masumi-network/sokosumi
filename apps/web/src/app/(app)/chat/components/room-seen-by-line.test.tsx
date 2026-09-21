import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useRoomReadReceipts } from "@/app/chat/hooks/use-room-read-receipts";
import type {
  ChatRoom,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { createTestFormatter } from "@/test/intl-formatter";

const formatter = createTestFormatter({ timeZone: "UTC", hourCycle: "h23" });

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    key === "summary" ? `Seen by ${values?.count} people` : key,
  useFormatter: () => formatter,
}));

import {
  RoomSeenByLine,
  seenByPendingFor,
  seenByReadersFor,
} from "./room-seen-by-line";

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
  return <RoomSeenByLine readers={readers} receipts={receipts} />;
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

  /**
   * Idea 2 and 4 in one assertion: grey and unringed until the group around
   * them is hovered, focused or open. Class tokens rather than computed
   * styles, because the variants only resolve in a real browser.
   */
  it("keeps the faces grey and unringed until the trigger wakes", () => {
    render(<Probe members={[member("user-a", "2026-01-01T13:00:00.000Z")]} />);

    const face = screen
      .getByTestId("read-receipt-face-user-a")
      .querySelector("[data-slot='avatar']");
    const tokens = face?.className.split(/\s+/) ?? [];

    expect(tokens).toContain("grayscale");
    expect(tokens).toContain("opacity-70");
    expect(tokens).toContain("group-hover:grayscale-0");
    expect(tokens).toContain("group-data-[state=open]:opacity-100");
    // The ring is what made them read as three badges on the text.
    expect(tokens).not.toContain("ring-1");
  });

  it("names every reader and when they read, newest first", async () => {
    const user = userEvent.setup();
    render(
      <Probe
        members={[
          member("user-a", "2026-01-01T13:05:00.000Z"),
          member("user-b", "2026-01-01T12:30:00.000Z"),
        ]}
      />,
    );

    const trigger = line();
    expect(trigger).not.toBeNull();
    await user.click(trigger as HTMLElement);

    const readers = await screen.findAllByTestId(/^room-seen-by-reader-/);
    expect(readers.map((row) => row.getAttribute("data-testid"))).toEqual([
      "room-seen-by-reader-user-a",
      "room-seen-by-reader-user-b",
    ]);
    expect(screen.getByTestId("room-seen-by-reader-user-a")).toHaveTextContent(
      "13:05",
    );
    expect(screen.getByTestId("room-seen-by-reader-user-b")).toHaveTextContent(
      "12:30",
    );
  });

  /**
   * The half the faces cannot show. A member who read older messages has read
   * *something*, so `nonReaders` alone would drop them from the answer
   * entirely — and "who has seen this" that silently omits people is the more
   * misleading of the two answers.
   */
  it("lists everyone who has not read this far, lagging readers included", async () => {
    const user = userEvent.setup();
    render(
      <Probe
        members={[
          member("user-read", "2026-01-01T13:00:00.000Z"),
          member("user-lagging", "2026-01-01T09:00:00.000Z"),
          member("user-never", null),
        ]}
      />,
    );

    await user.click(line() as HTMLElement);

    expect(
      await screen.findByTestId("room-seen-by-pending-user-lagging"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("room-seen-by-pending-user-never"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("room-seen-by-pending-user-read"),
    ).not.toBeInTheDocument();
  });

  it("says nothing about who has not read when everyone has", async () => {
    const user = userEvent.setup();
    render(<Probe members={[member("user-a", "2026-01-01T13:00:00.000Z")]} />);

    await user.click(line() as HTMLElement);

    expect(
      await screen.findByTestId("room-seen-by-reader-user-a"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("room-seen-by-pending-title"),
    ).not.toBeInTheDocument();
  });
});

describe("seenByPendingFor", () => {
  const reader = (id: string, at: string) => ({
    participant: member(id, at),
    lastReadAt: new Date(at),
  });

  it("puts lagging readers before those who never opened the room", () => {
    const here = reader("here", "2026-01-01T13:00:00.000Z");
    const lagging = reader("lagging", "2026-01-01T09:00:00.000Z");
    const never = member("never", null);

    const pending = seenByPendingFor({
      readers: [here],
      allReaders: [here, lagging],
      nonReaders: [never],
    });

    expect(pending.map((p) => p.id)).toEqual(["lagging", "never"]);
  });

  it("is empty when every reader has reached the message", () => {
    const here = reader("here", "2026-01-01T13:00:00.000Z");

    expect(
      seenByPendingFor({
        readers: [here],
        allReaders: [here],
        nonReaders: [],
      }),
    ).toEqual([]);
  });
});
