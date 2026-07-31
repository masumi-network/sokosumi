import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { ChatMessageRow } from "../room-message-row";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/jobs/job-details/file-chip-with-metadata", () => ({
  FileChipMiniPreviewWithMetadata: () => null,
}));

function userMessage(): ChatRoomMessage {
  return {
    id: "message-1",
    roomId: "room-1",
    parentMessageId: null,
    content: "Hello",
    createdAt: new Date("2026-07-01T14:35:00.000Z"),
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
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
  };
}

function renderContinuation() {
  render(
    <ChatMessageRow
      message={userMessage()}
      coworkersById={new Map()}
      coworkersBySlug={new Map()}
      onToggleReaction={vi.fn()}
      isContinuation
    />,
  );
}

describe("ChatMessageRow", () => {
  it("keeps sender attribution on continuation rows", () => {
    renderContinuation();

    expect(screen.getByRole("article", { name: "Ada" })).toBeInTheDocument();
  });

  it("keeps continuation timestamps on one line", () => {
    renderContinuation();

    expect(screen.getByRole("time")).toHaveClass("whitespace-nowrap");
  });
});
