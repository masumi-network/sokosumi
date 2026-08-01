import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { ChatMessageRow } from "../room-message-row";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "Reactions.whoReacted" && values) {
      const names = String(values.names ?? "");
      const more = Number(values.more ?? 0);
      return more > 0 ? `${names}, and ${more} more` : names;
    }
    if (key === "Reactions.andMore" && values) {
      return `and ${values.count} more`;
    }
    if (key === "jump" && values) {
      return `Jump to message from ${values.author}`;
    }
    if (key === "showMore") {
      return "More";
    }
    if (key === "showLess") {
      return "Less";
    }
    return key;
  },
}));

vi.mock("@/components/markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/jobs/job-details/file-chip-with-metadata", () => ({
  FileChipMiniPreviewWithMetadata: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div role="tooltip">{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function touchActions() {
  const node = document.querySelector('[data-message-actions="touch"]');
  if (!(node instanceof HTMLElement)) {
    throw new Error("Touch message actions chrome missing");
  }
  return within(node);
}

function userMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
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
    quote: null,
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
    ...overrides,
  };
}

function renderRow({
  message = userMessage(),
  isContinuation = false,
  onQuote,
}: {
  message?: ChatRoomMessage;
  isContinuation?: boolean;
  onQuote?: (message: ChatRoomMessage) => void;
} = {}) {
  render(
    <ChatMessageRow
      message={message}
      coworkersById={new Map()}
      coworkersBySlug={new Map()}
      onToggleReaction={vi.fn()}
      onQuote={onQuote}
      isContinuation={isContinuation}
    />,
  );
}

function renderContinuation(message: ChatRoomMessage = userMessage()) {
  renderRow({ message, isContinuation: true });
}

describe("ChatMessageRow", () => {
  it("keeps sender attribution on continuation rows", () => {
    renderRow({ isContinuation: true });

    expect(screen.getByRole("article", { name: "Ada" })).toBeInTheDocument();
  });

  it("keeps continuation timestamps on one line", () => {
    renderRow({ isContinuation: true });

    expect(screen.getByRole("time")).toHaveClass("whitespace-nowrap");
  });

  it("shows reactor names in reaction tooltip in API order", () => {
    renderContinuation(
      userMessage({
        reactions: [
          {
            emoji: "👍",
            count: 2,
            reactedByCurrentUser: true,
            reactors: [
              { id: "user-1", name: "Ada" },
              { id: "user-2", name: "Bob" },
            ],
          },
        ],
      }),
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent("Ada, Bob");
    expect(
      screen.getByRole("button", { name: "Reactions.toggle" }),
    ).toBeInTheDocument();
  });

  it("shows and N more when count exceeds listed reactors", () => {
    renderContinuation(
      userMessage({
        reactions: [
          {
            emoji: "🎉",
            count: 5,
            reactedByCurrentUser: false,
            reactors: [
              { id: "user-1", name: "Ada" },
              { id: "user-2", name: "Bob" },
              { id: "user-3", name: "Carol" },
            ],
          },
        ],
      }),
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Ada, Bob, Carol, and 2 more",
    );
  });

  it("keeps continuation rows tight so same-sender bursts stay dense", () => {
    renderRow({ isContinuation: true });

    const article = screen.getByRole("article", { name: "Ada" });
    expect(article).toHaveClass("py-0.5");
    expect(article).not.toHaveClass("py-2.5");
    expect(article).not.toHaveClass("mt-3");
  });

  it("separates author groups with top margin instead of fat vertical padding", () => {
    renderRow({ isContinuation: false });

    const article = screen.getByRole("article");
    expect(article).toHaveClass("mt-3");
    expect(article).toHaveClass("pb-0.5");
    expect(article).not.toHaveClass("py-2.5");
  });

  it("exposes message id for quote jump targets", () => {
    renderRow();

    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("id", "message-message-1");
    expect(article).toHaveAttribute("data-message-id", "message-1");
  });

  it("hides Quote on touch until message actions overflow opens", async () => {
    const user = userEvent.setup();
    const onQuote = vi.fn();
    renderRow({ onQuote });

    expect(
      touchActions().queryByRole("button", { name: "Quote.action" }),
    ).not.toBeInTheDocument();

    await user.click(
      touchActions().getByRole("button", { name: "Actions.more" }),
    );
    expect(
      touchActions().getByRole("button", { name: "Quote.action" }),
    ).toBeInTheDocument();
  });

  it("closes touch message actions on outside pointerdown", async () => {
    const user = userEvent.setup();
    renderRow({ onQuote: vi.fn() });

    await user.click(
      touchActions().getByRole("button", { name: "Actions.more" }),
    );
    expect(
      touchActions().getByRole("button", { name: "Quote.action" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("article"));

    expect(
      touchActions().queryByRole("button", { name: "Quote.action" }),
    ).not.toBeInTheDocument();
    expect(
      touchActions().getByRole("button", { name: "Actions.more" }),
    ).toBeInTheDocument();
  });

  it("shows Quote action and calls onQuote", async () => {
    const user = userEvent.setup();
    const onQuote = vi.fn();
    renderRow({ onQuote });

    await user.click(
      touchActions().getByRole("button", { name: "Actions.more" }),
    );
    await user.click(
      touchActions().getByRole("button", { name: "Quote.action" }),
    );
    expect(onQuote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1" }),
    );
  });

  it("reserves hover-only right gutter on article", () => {
    renderRow();

    const article = screen.getByRole("article");
    expect(article.className).toContain("[@media(hover:hover)]:pr-20");
    expect(article.className.split(/\s+/)).not.toContain("pr-20");
  });

  it("renders quote snapshot from DTO and soft-fails jump when target missing", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    renderRow({
      message: userMessage({
        content: "Reply body",
        quote: {
          messageId: "missing-original",
          authorName: "Bob",
          snippet: "Earlier thought",
        },
      }),
    });

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Earlier thought")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Jump to message from Bob" }),
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("styles @all mention tokens in quote snippets", () => {
    renderRow({
      message: userMessage({
        content: "Reply body",
        quote: {
          messageId: "original-1",
          authorName: "Bob",
          snippet: "please add @all:all tagging",
        },
      }),
    });

    const quoteButton = screen.getByRole("button", {
      name: "Jump to message from Bob",
    });
    // Markdown mock renders children as text, so the mention HTML string is visible.
    const formatted = quoteButton.textContent ?? "";
    expect(formatted).toContain("text-primary");
    expect(formatted).toContain(">@all</span>");
    expect(formatted).not.toContain("@all:all");
  });

  it("preserves newlines in multi-line quote snippets", () => {
    renderRow({
      message: userMessage({
        content: "Reply body",
        quote: {
          messageId: "original-2",
          authorName: "Bob",
          snippet: "line one\nline two",
        },
      }),
    });

    const quoteButton = screen.getByRole("button", {
      name: "Jump to message from Bob",
    });
    expect(quoteButton.textContent).toContain("line one\nline two");
  });

  it("clamps long quotes and expands with More/Less when content overflows", async () => {
    const user = userEvent.setup();
    const scrollDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    const clientDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 120;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 40;
      },
    });

    try {
      const fullSnippet =
        "Two more things about the chat here:\nCan you please make chat drafts persistent during tab-switches. Writing a long message and losing it because I quickly wanted to check sth. in another chat is painful :) and please add @all:all tagging functionality please.";

      renderRow({
        message: userMessage({
          content: "Reply body",
          quote: {
            messageId: "original-3",
            authorName: "Phil",
            snippet: fullSnippet,
          },
        }),
      });

      const jumpButton = screen.getByRole("button", {
        name: "Jump to message from Phil",
      });
      expect(jumpButton.querySelector(".line-clamp-4")).not.toBeNull();

      await user.click(screen.getByRole("button", { name: "More" }));
      expect(jumpButton.querySelector(".line-clamp-4")).toBeNull();
      expect(screen.getByRole("button", { name: "Less" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Less" }));
      expect(jumpButton.querySelector(".line-clamp-4")).not.toBeNull();
      expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
    } finally {
      if (scrollDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollHeight",
          scrollDescriptor,
        );
      }
      if (clientDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientHeight",
          clientDescriptor,
        );
      }
    }
  });

  it("hides More when the clamped quote does not overflow", () => {
    const scrollDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    const clientDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 20;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 20;
      },
    });

    try {
      renderRow({
        message: userMessage({
          content: "Reply body",
          quote: {
            messageId: "original-short",
            authorName: "Phil",
            snippet: "short quote",
          },
        }),
      });

      expect(
        screen.queryByRole("button", { name: "More" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Jump to message from Phil" }),
      ).toBeInTheDocument();
    } finally {
      if (scrollDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollHeight",
          scrollDescriptor,
        );
      }
      if (clientDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientHeight",
          clientDescriptor,
        );
      }
    }
  });
});
