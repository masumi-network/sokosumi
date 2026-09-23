/**
 * The reply bar under a thread parent in the room transcript (ADR-0037).
 *
 * It names the replies that are new to this reader while any are unread, and
 * falls back to the plain reply count otherwise.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "@/../messages/en.json";
import { createFormats } from "@/i18n/time-format";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { ChatMessageRow } from "./room-message-row";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

type ThreadFields = Pick<
  ChatRoomMessage,
  "threadReplyCount" | "threadUnreadReplyCount" | "threadRepliers"
>;

function parentMessage(counts: ThreadFields): ChatRoomMessage {
  return {
    id: "message-1",
    roomId: "room-1",
    parentMessageId: null,
    content: "Thread parent",
    createdAt: new Date("2026-07-01T14:35:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadLastReplyAt: new Date("2026-07-01T15:00:00.000Z"),
    metadata: null,
    quote: null,
    membership: null,
    unfurls: null,
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
    ...counts,
  };
}

function renderRow(
  counts: ThreadFields,
  onOpenThread: (message: ChatRoomMessage) => void = vi.fn(),
) {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      formats={createFormats()}
      timeZone="UTC"
      now={new Date("2026-07-01T15:04:00.000Z")}
    >
      <ChatMessageRow
        message={parentMessage(counts)}
        coworkersById={new Map()}
        coworkersBySlug={new Map()}
        onToggleReaction={vi.fn()}
        onOpenThread={onOpenThread}
      />
    </NextIntlClientProvider>,
  );
}

describe("thread reply bar", () => {
  it("shows the plain reply count when nothing is unread", () => {
    renderRow({ threadReplyCount: 3, threadUnreadReplyCount: 0 });

    const bar = screen.getByRole("button", { name: "3 replies" });
    expect(bar).not.toHaveAttribute("data-unread");
  });

  it("names the new replies when some are unread", () => {
    renderRow({ threadReplyCount: 5, threadUnreadReplyCount: 2 });

    const bar = screen.getByRole("button", { name: "2 new replies" });
    expect(bar).toHaveAttribute("data-unread", "true");
    expect(
      screen.queryByRole("button", { name: "5 replies" }),
    ).not.toBeInTheDocument();
  });

  it("uses the singular for one new reply", () => {
    renderRow({ threadReplyCount: 4, threadUnreadReplyCount: 1 });

    expect(screen.getByRole("button", { name: "1 new reply" })).toHaveAttribute(
      "data-unread",
      "true",
    );
  });

  // A lurker is not a Participant, so Core reports 0 unread for them however
  // busy the thread is.
  it("stays plain for a lurker on a busy thread", () => {
    renderRow({ threadReplyCount: 20, threadUnreadReplyCount: 0 });

    expect(
      screen.getByRole("button", { name: "20 replies" }),
    ).not.toHaveAttribute("data-unread");
  });

  it("stays plain when the count is absent from the payload", () => {
    renderRow({ threadReplyCount: 3 });

    expect(
      screen.getByRole("button", { name: "3 replies" }),
    ).not.toHaveAttribute("data-unread");
  });

  it("opens the thread from the unread bar", async () => {
    const onOpenThread = vi.fn();
    renderRow({ threadReplyCount: 5, threadUnreadReplyCount: 2 }, onOpenThread);

    await userEvent.click(
      screen.getByRole("button", { name: "2 new replies" }),
    );

    expect(onOpenThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1" }),
    );
  });

  it("shows the creator plus one face per replier and keeps the count as its name", () => {
    renderRow({
      threadReplyCount: 5,
      threadUnreadReplyCount: 2,
      threadRepliers: [
        {
          type: "user",
          user: {
            id: "user-2",
            name: "Grace",
            email: "grace@example.com",
            image: null,
            presence: "offline",
          },
        },
        {
          type: "coworker",
          coworker: {
            id: "cow-1",
            name: "Scout",
            slug: "scout",
            caption: null,
            image: null,
            presence: "online",
          },
        },
      ],
    });

    const bar = screen.getByRole("button", { name: "2 new replies" });
    expect(within(bar).getAllByTestId("thread-replier-face")).toHaveLength(3);
  });

  it("describes the bar with the last reply's age", () => {
    renderRow({ threadReplyCount: 3, threadUnreadReplyCount: 0 });

    expect(
      screen.getByRole("button", { name: "3 replies" }),
    ).toHaveAccessibleDescription("4m ago");
  });

  it("puts the thread creator first, then repliers in the order they joined", () => {
    renderRow({
      threadReplyCount: 4,
      threadUnreadReplyCount: 0,
      threadRepliers: [
        replier("user-2", "Grace"),
        replier("user-1", "Ada"),
        replier("user-3", "Linus"),
      ],
    });

    const bar = screen.getByRole("button", { name: "4 replies" });
    expect(
      within(bar)
        .getAllByTestId("thread-replier-face")
        .map((face) => face.textContent),
    ).toEqual(["A", "G", "L"]);
  });

  it("shows the thread creator even before they reply", () => {
    renderRow({
      threadReplyCount: 3,
      threadUnreadReplyCount: 0,
      threadRepliers: [
        replier("user-2", "Grace"),
        replier("user-3", "Linus"),
        replier("user-4", "Margaret"),
      ],
    });

    const bar = screen.getByRole("button", { name: "3 replies" });
    expect(
      within(bar)
        .getAllByTestId("thread-replier-face")
        .map((face) => face.textContent),
    ).toEqual(["A", "G", "L"]);
  });
});

function replier(
  id: string,
  name: string,
): NonNullable<ChatRoomMessage["threadRepliers"]>[number] {
  return {
    type: "user",
    user: {
      id,
      name,
      email: `${id}@example.com`,
      image: null,
      presence: "offline",
    },
  };
}
