import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PinnedMessagesPanel } from "@/app/chat/components/pinned-messages-panel";
import type { ChatRoomPinnedMessageListItem } from "@/lib/clients/generated/core";

const { listPinnedMessages } = vi.hoisted(() => ({
  listPinnedMessages: vi.fn(),
}));
vi.mock("@/app/chat/actions", () => ({
  listPinnedMessagesAction: listPinnedMessages,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({ formatTimeAgo: () => "1m ago" }),
}));
// Keep the real pinned panel, message segmentation and Markdown adapter. Only
// the final SVG renderer is replaced: this test checks where it is opted in.
vi.mock("@/components/mermaid/mermaid-block", () => ({
  MermaidBlock: ({ source }: { source: string }) => (
    <figure aria-label="diagram">{source}</figure>
  ),
}));

const diagram = "```mermaid\nflowchart LR\nA --> B\n```";

function renderPinned(content: string, quote: boolean) {
  listPinnedMessages.mockResolvedValue({
    ok: true,
    value: {
      nextCursor: null,
      items: [
        {
          messageId: "pinned",
          pinnedAt: new Date(),
          pinnedBy: { id: "user", name: "Ada" },
          message: {
            id: "pinned",
            content,
            createdAt: new Date(),
            sender: { type: "unknown" },
            roomId: "room",
            parentMessageId: null,
            editedAt: null,
            deletedAt: null,
            metadata: null,
            threadReplyCount: 0,
            threadLastReplyAt: null,
            mentions: [],
            reactions: [],
            pinnedAt: new Date(),
            membership: null,
            groupNameChange: null,
            unfurls: null,
            quote: quote
              ? { messageId: "original", authorName: "Ada", snippet: diagram }
              : null,
          },
        } satisfies ChatRoomPinnedMessageListItem,
      ],
    },
  });
  render(
    <PinnedMessagesPanel
      roomId="room"
      labels={{
        title: "Pinned",
        close: "Close",
        empty: "Empty",
        loading: "Loading",
        error: "Error",
        couldNotLoad: "Unavailable",
        unpin: "Unpin",
        loadOlder: "Older",
        jumping: "Jumping",
      }}
      listGeneration={0}
      coworkersById={new Map()}
      coworkersBySlug={new Map()}
      usersById={new Map()}
      usersBySlug={new Map()}
      channelLinks={[]}
      currentUserId="user"
      canOpenHumanDirect={false}
      onOpenDirectMessage={vi.fn()}
      openingDirectParticipantKey={null}
      onClose={vi.fn()}
      onJump={vi.fn(async () => true)}
      onUnpin={vi.fn(async () => true)}
    />,
  );
}

describe("pinned message Mermaid scope", () => {
  it("keeps a quote-only pinned snippet as source code", async () => {
    renderPinned("", true);
    const body = await screen.findByTestId("pinned-message-body");
    expect(body.querySelector("pre code")).toHaveTextContent("flowchart LR");
    expect(
      screen.queryByRole("figure", { name: "diagram" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    diagram,
    `${diagram}\n\n[report.pdf](https://example.com/report.pdf)\n\n${diagram}`,
  ])("renders diagrams in the pinned message's own body", async (content) => {
    renderPinned(content, true);
    expect(
      (await screen.findAllByRole("figure", { name: "diagram" })).length,
    ).toBe(content === diagram ? 1 : 2);
  });
});
