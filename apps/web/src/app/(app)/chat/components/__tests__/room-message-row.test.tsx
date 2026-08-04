import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { ChatMessageRow } from "../room-message-row";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) => {
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
        return namespace === "App.Channels.Message" ? "Show more" : "More";
      }
      if (key === "showLess") {
        return namespace === "App.Channels.Message" ? "Show less" : "Less";
      }
      return key;
    };
  },
}));

vi.mock("@/components/markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/file-chip-mini-preview", () => ({
  FileChipMiniPreviewFrame: ({
    fileName,
  }: {
    fileName: string;
    url: string;
    sizeClass?: string;
  }) => <span data-testid="chip">{fileName}</span>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div role="tooltip">{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function userMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id: "message-1",
    roomId: "room-1",
    parentMessageId: null,
    content: "Hello",
    createdAt: new Date("2026-07-01T14:35:00.000Z"),
    editedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
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

function coworkerMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    ...userMessage(overrides),
    sender: {
      type: "coworker",
      coworker: {
        id: "cow-1",
        name: "Jamal",
        slug: "jamal",
        caption: null,
        image: null,
        presence: "online",
      },
    },
  };
}

function renderRow({
  message = userMessage(),
  isContinuation = false,
  isFirstOfDay = false,
  onQuote,
  currentUserId,
  onStartEdit,
  onDelete,
  isEditing = false,
  editDraft = "",
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  isSavingEdit = false,
}: {
  message?: ChatRoomMessage;
  isContinuation?: boolean;
  isFirstOfDay?: boolean;
  onQuote?: (message: ChatRoomMessage) => void;
  currentUserId?: string;
  onStartEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  isEditing?: boolean;
  editDraft?: string;
  onEditDraftChange?: (value: string) => void;
  onCancelEdit?: () => void;
  onSaveEdit?: () => void;
  isSavingEdit?: boolean;
} = {}) {
  render(
    <ChatMessageRow
      message={message}
      coworkersById={new Map()}
      coworkersBySlug={new Map()}
      currentUserId={currentUserId}
      onToggleReaction={vi.fn()}
      onQuote={onQuote}
      onStartEdit={onStartEdit}
      onDelete={onDelete}
      isEditing={isEditing}
      editDraft={editDraft}
      onEditDraftChange={onEditDraftChange}
      onCancelEdit={onCancelEdit}
      onSaveEdit={onSaveEdit}
      isSavingEdit={isSavingEdit}
      isContinuation={isContinuation}
      isFirstOfDay={isFirstOfDay}
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
    expect(article).toHaveClass("mt-2");
    expect(article).toHaveClass("pb-0.5");
    expect(article).not.toHaveClass("py-2.5");
  });

  it("omits top margin for first message of the day after a day separator", () => {
    renderRow({ isContinuation: false, isFirstOfDay: true });

    const article = screen.getByRole("article");
    expect(article).toHaveClass("mt-0");
    expect(article).not.toHaveClass("mt-2");
    expect(article).not.toHaveClass("mt-3");
  });

  it("exposes message id for quote jump targets", () => {
    renderRow();

    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("id", "message-message-1");
    expect(article).toHaveAttribute("data-message-id", "message-1");
  });

  it("keeps Quote out of the sheet until message actions open", async () => {
    const user = userEvent.setup();
    const onQuote = vi.fn();
    renderRow({ onQuote });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const openActions = screen.getByRole("button", { name: "Actions.more" });
    expect(openActions).toHaveClass("sr-only");
    await user.click(openActions);

    const sheet = screen.getByRole("dialog");
    expect(
      within(sheet).getByRole("button", { name: "Quote.action" }),
    ).toBeInTheDocument();
  });

  it("shows Quote action in the sheet and calls onQuote", async () => {
    const user = userEvent.setup();
    const onQuote = vi.fn();
    renderRow({ onQuote });

    await user.click(screen.getByRole("button", { name: "Actions.more" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Quote.action",
      }),
    );
    expect(onQuote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses the sheet when swiped down past the threshold", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderRow({ onQuote: vi.fn() });
      await user.click(screen.getByRole("button", { name: "Actions.more" }));

      const sheet = screen.getByRole("dialog");
      const handle = sheet.querySelector("[data-sheet-swipe-handle]");
      expect(handle).toBeTruthy();

      await act(async () => {
        handle!.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerId: 1,
            clientX: 40,
            clientY: 20,
          }),
        );
        sheet.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerId: 1,
            clientX: 40,
            clientY: 140,
          }),
        );
        sheet.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            pointerId: 1,
            clientX: 40,
            clientY: 140,
          }),
        );
        await vi.advanceTimersByTimeAsync(200);
      });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens message actions sheet after long-press when hover is unavailable", async () => {
    const matchMediaSpy = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

    try {
      vi.useFakeTimers();
      renderRow({ onQuote: vi.fn() });
      const article = screen.getByRole("article");

      await act(async () => {
        article.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 10,
            clientY: 10,
          }),
        );
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      matchMediaSpy.mockRestore();
    }
  });

  it("shows who reacted in the message actions sheet when hover is unavailable", async () => {
    const matchMediaSpy = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

    try {
      vi.useFakeTimers();
      renderRow({
        onQuote: vi.fn(),
        message: userMessage({
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
      });
      const article = screen.getByRole("article");

      await act(async () => {
        article.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 10,
            clientY: 10,
          }),
        );
        await vi.advanceTimersByTimeAsync(500);
      });

      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("list", { name: "Reactions.whoReactedList" }),
      ).toBeInTheDocument();
      expect(within(dialog).getByText("Ada, Bob")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      matchMediaSpy.mockRestore();
    }
  });

  it("clears native text selection when long-press opens message actions", async () => {
    const matchMediaSpy = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

    try {
      vi.useFakeTimers();
      renderRow({
        message: userMessage({ content: "Selectable chat body" }),
        onQuote: vi.fn(),
      });
      const article = screen.getByRole("article");

      const range = document.createRange();
      range.selectNodeContents(article);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      expect(selection?.rangeCount).toBeGreaterThan(0);

      await act(async () => {
        article.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 10,
            clientY: 10,
          }),
        );
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
      expect(article.className).toContain("[@media(hover:none)]:select-none");
      expect(article.className).toContain(
        "[@media(hover:none)]:[-webkit-touch-callout:none]",
      );
    } finally {
      vi.useRealTimers();
      matchMediaSpy.mockRestore();
    }
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

  it("shows quote image attachment as inert thumbnail, not a link", () => {
    renderRow({
      message: userMessage({
        content: "Reply body",
        quote: {
          messageId: "original-image",
          authorName: "Bob",
          snippet: "check this shot",
          attachment: {
            fileName: "launch.png",
            url: "https://blob.example/launch.png",
            mediaKind: "image",
          },
        },
      }),
    });

    const jumpButton = screen.getByRole("button", {
      name: "Jump to message from Bob",
    });
    const thumb = jumpButton.querySelector(
      'img[src="https://blob.example/launch.png"]',
    );
    expect(thumb).toBeInTheDocument();
    expect(thumb).toHaveAttribute("alt", "");
    expect(
      screen.queryByRole("link", { name: /launch\.png/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("check this shot")).toBeInTheDocument();
  });

  it("shows quote file attachment as inert icon thumb, not a link", () => {
    renderRow({
      message: userMessage({
        content: "Reply body",
        quote: {
          messageId: "original-file",
          authorName: "Bob",
          snippet: "see the brief",
          attachment: {
            fileName: "brief.pdf",
            url: "https://blob.example/brief.pdf",
            mediaKind: "file",
          },
        },
      }),
    });

    const jumpButton = screen.getByRole("button", {
      name: "Jump to message from Bob",
    });
    expect(
      screen.queryByRole("link", { name: /brief\.pdf/i }),
    ).not.toBeInTheDocument();
    expect(jumpButton.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("brief.pdf")).not.toBeInTheDocument();
  });

  it("jumps to original message when quote attachment thumb is clicked", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const original = document.createElement("article");
    original.setAttribute("data-message-id", "original-with-thumb");
    document.body.appendChild(original);

    try {
      renderRow({
        message: userMessage({
          content: "Reply body",
          quote: {
            messageId: "original-with-thumb",
            authorName: "Bob",
            snippet: "check this shot",
            attachment: {
              fileName: "launch.png",
              url: "https://blob.example/launch.png",
              mediaKind: "image",
            },
          },
        }),
      });

      const jumpButton = screen.getByRole("button", {
        name: "Jump to message from Bob",
      });
      const thumb = jumpButton.querySelector(
        'img[src="https://blob.example/launch.png"]',
      );
      expect(thumb).toBeTruthy();
      await user.click(thumb!);
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      original.remove();
    }
  });

  it("keeps legacy quotes without attachment text-only", () => {
    renderRow({
      message: userMessage({
        content: "Reply body",
        quote: {
          messageId: "legacy-quote",
          authorName: "Bob",
          snippet: "old text-only quote",
        },
      }),
    });

    expect(screen.getByText("old text-only quote")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("wraps consecutive file attachments in one horizontal row", () => {
    renderRow({
      message: userMessage({
        content:
          "[a.png](https://cdn.example/a.png)\n[b.png](https://cdn.example/b.png)\n",
      }),
    });

    const rows = screen.getAllByTestId("room-message-attachment-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getAllByTestId("chip")).toHaveLength(2);
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

  it("clamps long message bodies and expands with Show more/Show less", async () => {
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
        return 400;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 80;
      },
    });

    try {
      const longBody = Array.from(
        { length: 20 },
        (_, i) => `Line ${i + 1} of a very long chat message.`,
      ).join("\n");

      renderRow({
        message: userMessage({ content: longBody }),
      });

      const body = screen.getByTestId("room-message-body");
      expect(body.className).toContain("line-clamp-[16]");
      expect(
        screen.getByRole("button", { name: "Show more" }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Show more" }));
      expect(body.className).not.toContain("line-clamp-[16]");
      expect(
        screen.getByRole("button", { name: "Show less" }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Show less" }));
      expect(body.className).toContain("line-clamp-[16]");
      expect(
        screen.getByRole("button", { name: "Show more" }),
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

  it("renders emoji-only messages as jumbo", () => {
    renderRow({
      message: userMessage({ content: "👍" }),
    });

    const body = screen.getByTestId("room-message-body");
    expect(body).toHaveAttribute("data-jumbo-emoji", "1");
    expect(body.className).toContain("text-4xl");
    expect(body.className).not.toContain("line-clamp-[16]");
  });

  it("keeps mixed text+emoji at normal size", () => {
    renderRow({
      message: userMessage({ content: "foobar 👍" }),
    });

    const body = screen.getByTestId("room-message-body");
    expect(body).not.toHaveAttribute("data-jumbo-emoji");
    expect(body.className).not.toContain("text-4xl");
  });

  it("hides Show more when the message body does not overflow", () => {
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
        return 40;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 40;
      },
    });

    try {
      renderRow({
        message: userMessage({ content: "Short message" }),
      });

      expect(screen.getByTestId("room-message-body").className).toContain(
        "line-clamp-[16]",
      );
      expect(
        screen.queryByRole("button", { name: "Show more" }),
      ).not.toBeInTheDocument();
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

  it("shows Edit for own user messages and hides for others", async () => {
    const user = userEvent.setup();
    const onStartEdit = vi.fn();

    const { rerender } = render(
      <ChatMessageRow
        message={userMessage()}
        coworkersById={new Map()}
        coworkersBySlug={new Map()}
        currentUserId="user-1"
        onToggleReaction={vi.fn()}
        onStartEdit={onStartEdit}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Edit.action" }),
    ).toBeInTheDocument();

    rerender(
      <ChatMessageRow
        message={userMessage()}
        coworkersById={new Map()}
        coworkersBySlug={new Map()}
        currentUserId="other-user"
        onToggleReaction={vi.fn()}
        onStartEdit={onStartEdit}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Edit.action" }),
    ).not.toBeInTheDocument();

    rerender(
      <ChatMessageRow
        message={coworkerMessage()}
        coworkersById={new Map()}
        coworkersBySlug={new Map()}
        currentUserId="user-1"
        onToggleReaction={vi.fn()}
        onStartEdit={onStartEdit}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Edit.action" }),
    ).not.toBeInTheDocument();

    rerender(
      <ChatMessageRow
        message={userMessage({ id: "stream:temp" })}
        coworkersById={new Map()}
        coworkersBySlug={new Map()}
        currentUserId="user-1"
        onToggleReaction={vi.fn()}
        onStartEdit={onStartEdit}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Edit.action" }),
    ).not.toBeInTheDocument();

    rerender(
      <ChatMessageRow
        message={userMessage()}
        coworkersById={new Map()}
        coworkersBySlug={new Map()}
        currentUserId="user-1"
        onToggleReaction={vi.fn()}
        onStartEdit={onStartEdit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit.action" }));
    expect(onStartEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1" }),
    );
  });

  it("shows Edited when editedAt is set", () => {
    renderRow({
      message: userMessage({
        editedAt: new Date("2026-07-01T15:00:00.000Z"),
      }),
    });

    expect(screen.getByText("Edit.edited")).toBeInTheDocument();
  });

  it("renders inline editor when isEditing", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();
    const onEditDraftChange = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original fixed",
      onEditDraftChange,
      onCancelEdit,
      onSaveEdit,
    });

    expect(screen.getByDisplayValue("Original fixed")).toBeInTheDocument();
    expect(screen.queryByText("Original")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit.save" }));
    expect(onSaveEdit).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Edit.cancel" }));
    expect(onCancelEdit).toHaveBeenCalled();
  });

  it("shows Delete in the sheet for the author and calls onDelete after confirm", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    renderRow({
      currentUserId: "user-1",
      onDelete,
      onQuote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Actions.more" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Message.delete",
      }),
    );

    const confirmDialog = await screen.findByRole("alertdialog");
    expect(
      within(confirmDialog).getByText("Message.deleteConfirm"),
    ).toBeInTheDocument();

    await user.click(
      within(confirmDialog).getByRole("button", { name: "Message.delete" }),
    );

    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("cancels delete without calling onDelete", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    renderRow({
      currentUserId: "user-1",
      onDelete,
      onQuote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Actions.more" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Message.delete",
      }),
    );

    const confirmDialog = await screen.findByRole("alertdialog");
    await user.click(
      within(confirmDialog).getByRole("button", { name: "Actions.cancel" }),
    );

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("does not show Delete for other authors", async () => {
    const user = userEvent.setup();
    renderRow({
      currentUserId: "user-2",
      onDelete: vi.fn(),
      onQuote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Actions.more" }));
    expect(
      within(screen.getByRole("dialog")).queryByRole("button", {
        name: "Message.delete",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows a tombstone and hides message actions when deleted", () => {
    renderRow({
      currentUserId: "user-1",
      onDelete: vi.fn(),
      onQuote: vi.fn(),
      message: userMessage({
        content: "",
        deletedAt: new Date("2026-07-02T10:00:00.000Z"),
      }),
    });

    expect(screen.getByText("Message.deleted")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Actions.more" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Message.delete" }),
    ).not.toBeInTheDocument();
  });
});
