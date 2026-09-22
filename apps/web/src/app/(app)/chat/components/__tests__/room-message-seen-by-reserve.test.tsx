/**
 * Regression: the Seen by faces must not shorten every line of a message.
 *
 * The faces are pinned to the row's bottom-right corner, and the column used
 * to reserve `pe-20` for them. On a phone that column is ~310px wide, so the
 * newest message in every room lost a quarter of each line — reported as the
 * chat "not using the full width" on mobile. The reserve is now inline, on
 * the last line only, and only when the body is what ends the row.
 */
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useFormatter: () => ({ dateTime: () => "1:28 AM" }),
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div role="tooltip">{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { ChatMessageRow } from "../room-message-row";

const COLUMN_RESERVE_CLASS = "pe-20";

function message(overrides: Partial<ChatRoomMessage> = {}): ChatRoomMessage {
  return {
    id: "message-1",
    roomId: "room-1",
    parentMessageId: null,
    content: "like i cant delete tasks from phil, or assign myself",
    createdAt: new Date("2026-07-01T01:28:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    unfurls: null,
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name: "Patrick Tobler",
        email: "patrick@example.com",
        image: null,
        presence: "offline",
      },
    },
    ...overrides,
  } as unknown as ChatRoomMessage;
}

function renderRow({
  seenBy = true,
  onOpenThread,
  ...overrides
}: Partial<ChatRoomMessage> & {
  seenBy?: boolean;
  onOpenThread?: () => void;
} = {}) {
  return render(
    <ChatMessageRow
      message={message(overrides)}
      coworkersById={new Map()}
      coworkersBySlug={new Map()}
      onToggleReaction={vi.fn()}
      onOpenThread={onOpenThread}
      seenBy={seenBy ? <span data-testid="seen-by-faces" /> : undefined}
    />,
  );
}

function inlineReserve(container: HTMLElement) {
  return container.querySelector('[data-testid="seen-by-inline-reserve"]');
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Seen by reserve", () => {
  it("never reserves on the message column, so every line runs full width", () => {
    const { container } = renderRow();

    expect(container.innerHTML).not.toContain(COLUMN_RESERVE_CLASS);
  });

  it("reserves inline on the last line when the body ends the row", () => {
    const { container } = renderRow();

    expect(inlineReserve(container)).not.toBeNull();
  });

  it("reserves nothing when a reaction row already clears the corner", () => {
    const { container } = renderRow({
      reactions: [
        {
          emoji: "👍",
          count: 1,
          reactors: [{ id: "user-2", name: "Ada" }],
        },
      ] as unknown as ChatRoomMessage["reactions"],
    });

    expect(inlineReserve(container)).toBeNull();
  });

  it("reserves nothing when a thread link already clears the corner", () => {
    const { container } = renderRow({
      threadReplyCount: 3,
      onOpenThread: vi.fn(),
    });

    expect(inlineReserve(container)).toBeNull();
  });

  it("reserves nothing on a row without Seen by faces", () => {
    const { container } = renderRow({ seenBy: false });

    expect(inlineReserve(container)).toBeNull();
  });
});
