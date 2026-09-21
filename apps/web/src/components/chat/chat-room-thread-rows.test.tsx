/**
 * The unread Threads of one room, inset under its sidebar row (ADR-0037).
 */
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import messages from "@/../messages/en.json";

import { ChatRoomThreadRows } from "./chat-room-thread-rows";

// `replace` never reaches the DOM, so the stand-in writes it where a test
// can read it.
vi.mock("next/link", () => ({
  default: ({
    replace,
    href,
    ...props
  }: ComponentProps<"a"> & { replace?: boolean; href: string }) => (
    <a href={href} data-replace={replace ? "true" : undefined} {...props} />
  ),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";

function thread(
  n: number,
  overrides: { parentContent?: string; unreadMentionCount?: number } = {},
) {
  return {
    unreadMentionCount: overrides.unreadMentionCount ?? 0,
    parentMessageId: `550e8400-e29b-41d4-a716-446655440b0${n}`,
    firstUnreadReplyId: `550e8400-e29b-41d4-a716-446655440c0${n}`,
    parentContent: overrides.parentContent ?? `Thread ${n}`,
    unreadReplyCount: n,
  };
}

function renderRows(room: {
  unreadThreads?: ReturnType<typeof thread>[];
  unreadThreadCount?: number;
  userMembers?: Array<{ id: string; name: string; email: string }>;
  isActive?: boolean;
}) {
  const { isActive, ...roomFields } = room;
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChatRoomThreadRows
        room={{
          id: ROOM_ID,
          userMembers: [],
          coworkerMembers: [],
          sokoBotMembers: [],
          ...roomFields,
        }}
        roomLabel="product-launch"
        isActive={isActive}
      />
    </NextIntlClientProvider>,
  );
}

describe("ChatRoomThreadRows", () => {
  it("renders one row per unread thread, naming it and its unread count", () => {
    renderRows({
      unreadThreads: [thread(2, { parentContent: "Vendor-wide rollout" })],
      unreadThreadCount: 1,
    });

    const list = screen.getByRole("list", {
      name: "Unread threads in product-launch",
    });
    const row = within(list).getByRole("link", {
      name: /Vendor-wide rollout/,
    });
    expect(row).toHaveAccessibleName(/2 unread replies/);
  });

  // A Thread that still holds an unread reply naming the reader. Counted from
  // the replies, so it clears on a Look, not when the room's badge does.
  it("marks a thread whose unread replies mention the reader", () => {
    renderRows({
      unreadThreads: [
        thread(3, { parentContent: "Pricing copy", unreadMentionCount: 1 }),
        thread(2, { parentContent: "Release notes" }),
      ],
      unreadThreadCount: 2,
    });

    const mentioned = screen.getByRole("link", { name: /Pricing copy/ });
    expect(mentioned).toHaveAttribute("data-mention", "true");
    expect(mentioned).toHaveAccessibleName(/1 mention/);
    expect(mentioned).toHaveAccessibleName(/3 unread replies/);

    const plain = screen.getByRole("link", { name: /Release notes/ });
    expect(plain).not.toHaveAttribute("data-mention");
    expect(plain).not.toHaveAccessibleName(/mention/);
  });

  it("opens the thread at its first unread reply", () => {
    renderRows({ unreadThreads: [thread(1)], unreadThreadCount: 1 });

    expect(screen.getByRole("link", { name: /Thread 1/ })).toHaveAttribute(
      "href",
      `/chat/rooms/${ROOM_ID}?message=550e8400-e29b-41d4-a716-446655440c01`,
    );
  });

  // The room takes the ask straight back off its URL. From inside that room
  // a pushed entry would leave Back landing on the view the reader is on.
  it("replaces rather than pushes when the reader is already in the room", () => {
    renderRows({
      unreadThreads: [thread(1), thread(2), thread(3)],
      unreadThreadCount: 5,
      isActive: true,
    });

    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("data-replace", "true");
    }
  });

  it("pushes when the link leads to another room", () => {
    renderRows({
      unreadThreads: [thread(1), thread(2), thread(3)],
      unreadThreadCount: 5,
    });

    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("data-replace");
    }
  });

  it("renders nothing when no thread is unread", () => {
    const { container } = renderRows({
      unreadThreads: [],
      unreadThreadCount: 0,
    });

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a room snapshot that carries no thread list", () => {
    const { container } = renderRows({});

    expect(container).toBeEmptyDOMElement();
  });

  it("shows no overflow row when every unread thread is listed", () => {
    renderRows({
      unreadThreads: [thread(1), thread(2), thread(3)],
      unreadThreadCount: 3,
    });

    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  // The cap hides rows, never the truth.
  it("states the true remainder beyond the cap and opens the thread list", () => {
    renderRows({
      unreadThreads: [thread(1), thread(2), thread(3)],
      unreadThreadCount: 7,
    });

    expect(
      screen.getByRole("link", { name: "4 more unread threads" }),
    ).toHaveAttribute("href", `/chat/rooms/${ROOM_ID}?threads=1`);
  });

  it("uses the singular for one thread beyond the cap", () => {
    renderRows({
      unreadThreads: [thread(1), thread(2), thread(3)],
      unreadThreadCount: 4,
    });

    expect(
      screen.getByRole("link", { name: "1 more unread thread" }),
    ).toBeInTheDocument();
  });

  it("names a mentioned member instead of showing the mention token", () => {
    renderRows({
      unreadThreads: [
        thread(1, {
          parentContent:
            "@019fc7e4-e4bd-7005-900c-66e44d33f5e4 can you check this?",
        }),
      ],
      unreadThreadCount: 1,
      userMembers: [
        {
          id: "019fc7e4-e4bd-7005-900c-66e44d33f5e4",
          name: "Kim Ferrari",
          email: "k@x.io",
        },
      ],
    });

    const row = screen.getByRole("link", { name: /can you check this/ });
    expect(row).toHaveAccessibleName(/Kim Ferrari/);
    expect(row).not.toHaveAccessibleName(/019fc7e4/);
  });

  it("reads the room-wide mention the way the thread list does", () => {
    renderRows({
      unreadThreads: [thread(1, { parentContent: "@all standup moved" })],
      unreadThreadCount: 1,
    });

    expect(
      screen.getByRole("link", { name: /Everyone standup moved/ }),
    ).toBeInTheDocument();
  });

  it("falls back to a plain label when the parent has no text", () => {
    renderRows({
      unreadThreads: [thread(1, { parentContent: "" })],
      unreadThreadCount: 1,
    });

    expect(screen.getByRole("link", { name: /^Thread/ })).toBeInTheDocument();
  });
});
