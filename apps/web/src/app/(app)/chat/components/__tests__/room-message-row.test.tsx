import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
} from "@/lib/clients/generated/core";

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
      if (key === "openLink" && values) {
        return `Open link preview: ${values.title}`;
      }
      if (key === "imageAlt" && values) {
        return `Preview image for ${values.title}`;
      }
      if (key === "reasoning.thoughtForDuration" && values?.duration != null) {
        return `Thought for ${String(values.duration)}`;
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
    sizeClass,
    variant,
  }: {
    fileName: string;
    url: string;
    sizeClass?: string;
    variant?: "thumb" | "large";
  }) => (
    <span
      data-testid="chip"
      data-variant={variant ?? "thumb"}
      data-size-class={sizeClass ?? ""}
    >
      {fileName}
    </span>
  ),
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
  onRetryOutbound,
  onRemoveOutbound,
  showOutboundSentTick = false,
  isEditing = false,
  editDraft = "",
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  isSavingEdit = false,
  coworkersById = new Map(),
}: {
  message?: ChatRoomMessage;
  isContinuation?: boolean;
  isFirstOfDay?: boolean;
  onQuote?: (message: ChatRoomMessage) => void;
  currentUserId?: string;
  onStartEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  onRetryOutbound?: (message: ChatRoomMessage) => void;
  onRemoveOutbound?: (message: ChatRoomMessage) => void;
  showOutboundSentTick?: boolean;
  isEditing?: boolean;
  editDraft?: string;
  onEditDraftChange?: (value: string) => void;
  onCancelEdit?: () => void;
  onSaveEdit?: (content?: string) => void;
  isSavingEdit?: boolean;
  coworkersById?: Map<string, ChatRoomCoworkerParticipant>;
} = {}) {
  render(
    <ChatMessageRow
      message={message}
      coworkersById={coworkersById}
      coworkersBySlug={new Map()}
      currentUserId={currentUserId}
      onToggleReaction={vi.fn()}
      onQuote={onQuote}
      onStartEdit={onStartEdit}
      onDelete={onDelete}
      onRetryOutbound={onRetryOutbound}
      onRemoveOutbound={onRemoveOutbound}
      showOutboundSentTick={showOutboundSentTick}
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
  it("shows coworker bot badge on avatar, not beside name", () => {
    renderRow({ message: coworkerMessage() });

    // File mock returns i18n keys (not English copy); label is coworkerBadge
    const badge = screen.getByRole("img", { name: "coworkerBadge" });
    expect(badge).toHaveAttribute("data-testid", "coworker-avatar-badge");
    // Single labeled chip — catches a residual name-row Bot with the same label
    expect(screen.getAllByRole("img", { name: "coworkerBadge" })).toHaveLength(
      1,
    );

    const name = screen.getByText("Jamal");
    expect(name).toHaveTextContent("Jamal");
    // Badge is under the avatar trigger, not under the name hover trigger
    expect(name.parentElement).not.toContainElement(badge);

    // HoverCard merges self-start/shrink-0 onto this trigger; size-8 keeps absolute badge on avatar
    const avatarWrap = screen.getByTestId("message-sender-avatar");
    expect(avatarWrap).toHaveClass(
      "relative",
      "size-8",
      "shrink-0",
      "self-start",
    );
    expect(avatarWrap).toContainElement(badge);
  });

  it("does not show coworker bot badge for human senders", () => {
    renderRow({ message: userMessage() });

    expect(
      screen.queryByTestId("coworker-avatar-badge"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "coworkerBadge" }),
    ).not.toBeInTheDocument();
  });

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

  it("uses large variant for a single image attachment", () => {
    renderRow({
      message: userMessage({
        content: "[photo.png](https://cdn.example/photo.png)\n",
      }),
    });

    const chip = screen.getByTestId("chip");
    expect(chip).toHaveAttribute("data-variant", "large");
    expect(chip).toHaveAttribute("data-size-class", "");
  });

  it("keeps thumb size-16 for multiple consecutive image attachments", () => {
    renderRow({
      message: userMessage({
        content:
          "[a.png](https://cdn.example/a.png)\n[b.png](https://cdn.example/b.png)\n",
      }),
    });

    const chips = within(
      screen.getByTestId("room-message-attachment-row"),
    ).getAllByTestId("chip");
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip).toHaveAttribute("data-variant", "thumb");
      expect(chip).toHaveAttribute("data-size-class", "size-16");
    }
  });

  it("keeps thumb size-16 for a single non-image attachment", () => {
    renderRow({
      message: userMessage({
        content: "[notes.pdf](https://cdn.example/notes.pdf)\n",
      }),
    });

    const chip = screen.getByTestId("chip");
    expect(chip).toHaveAttribute("data-variant", "thumb");
    expect(chip).toHaveAttribute("data-size-class", "size-16");
  });

  it("does not line-clamp bodies that include a large solo image attachment", () => {
    renderRow({
      message: userMessage({
        content: "[photo.png](https://cdn.example/photo.png)\n",
      }),
    });

    const body = screen.getByTestId("room-message-body");
    expect(body.className).not.toContain("line-clamp-[16]");
    expect(
      screen.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();
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

  it("renders inline editor when isEditing without Save/Cancel buttons", () => {
    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original fixed",
      onEditDraftChange: vi.fn(),
      onCancelEdit: vi.fn(),
      onSaveEdit: vi.fn(),
    });

    expect(screen.getByDisplayValue("Original fixed")).toBeInTheDocument();
    expect(screen.queryByText("Original")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit.save" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit.cancel" }),
    ).not.toBeInTheDocument();
  });

  it("places the caret at the end of the draft when edit mode opens", () => {
    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original fixed",
      onEditDraftChange: vi.fn(),
      onCancelEdit: vi.fn(),
      onSaveEdit: vi.fn(),
    });

    const textarea = screen.getByDisplayValue(
      "Original fixed",
    ) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe("Original fixed".length);
    expect(textarea.selectionEnd).toBe("Original fixed".length);
  });

  it("saves on Enter and cancels on Escape while editing", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original fixed",
      onEditDraftChange: vi.fn(),
      onCancelEdit,
      onSaveEdit,
    });

    const textarea = screen.getByDisplayValue("Original fixed");
    textarea.focus();

    await user.keyboard("{Enter}");
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    expect(onSaveEdit).toHaveBeenCalledWith("Original fixed");

    await user.keyboard("{Escape}");
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("does not save on Shift+Enter while editing", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original fixed",
      onEditDraftChange: vi.fn(),
      onCancelEdit,
      onSaveEdit,
    });

    screen.getByDisplayValue("Original fixed").focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(onCancelEdit).not.toHaveBeenCalled();
  });

  it("cancels on Enter when draft is unchanged", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original",
      onEditDraftChange: vi.fn(),
      onCancelEdit,
      onSaveEdit,
    });

    screen.getByDisplayValue("Original").focus();
    await user.keyboard("{Enter}");
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("saves live textarea value on Enter even if draft prop is stale", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      // Parent draft still original (stale) while DOM has been typed into.
      editDraft: "Original",
      onEditDraftChange: vi.fn(),
      onCancelEdit: vi.fn(),
      onSaveEdit,
    });

    const textarea = screen.getByDisplayValue(
      "Original",
    ) as HTMLTextAreaElement;
    textarea.focus();
    // Bypass React onChange so the controlled prop stays stale while DOM updates.
    textarea.value = "Original fixed live";
    await user.keyboard("{Enter}");
    expect(onSaveEdit).toHaveBeenCalledWith("Original fixed live");
  });

  it("cancels on blur when draft is unchanged", async () => {
    const user = userEvent.setup();
    const onCancelEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original",
      onEditDraftChange: vi.fn(),
      onCancelEdit,
      onSaveEdit: vi.fn(),
    });

    const textarea = screen.getByDisplayValue("Original");
    textarea.focus();
    await user.tab(); // move focus away → blur
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("does not cancel on blur when draft is dirty", async () => {
    const user = userEvent.setup();
    const onCancelEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original fixed",
      onEditDraftChange: vi.fn(),
      onCancelEdit,
      onSaveEdit: vi.fn(),
    });

    const textarea = screen.getByDisplayValue("Original fixed");
    textarea.focus();
    await user.tab();
    expect(onCancelEdit).not.toHaveBeenCalled();
  });

  it("does not cancel on blur when live DOM is dirty but draft prop is stale", async () => {
    const user = userEvent.setup();
    const onCancelEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original",
      onEditDraftChange: vi.fn(),
      onCancelEdit,
      onSaveEdit: vi.fn(),
    });

    const textarea = screen.getByDisplayValue(
      "Original",
    ) as HTMLTextAreaElement;
    textarea.focus();
    textarea.value = "Original fixed live";
    await user.tab();
    expect(onCancelEdit).not.toHaveBeenCalled();
  });

  it("cancels on Enter when draft is empty", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "",
      onEditDraftChange: vi.fn(),
      onCancelEdit,
      onSaveEdit,
    });

    screen.getByRole("textbox").focus();
    await user.keyboard("{Enter}");
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("saves on Ctrl+Enter as an alias while editing", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original fixed",
      onEditDraftChange: vi.fn(),
      onCancelEdit: vi.fn(),
      onSaveEdit,
    });

    screen.getByDisplayValue("Original fixed").focus();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSaveEdit).toHaveBeenCalledWith("Original fixed");
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

  it("renders Slack-style unfurl cards below the message body", () => {
    renderRow({
      message: userMessage({
        content: "Check https://example.com/article",
        unfurls: [
          {
            url: "https://example.com/article",
            title: "Example Article",
            description: "A short summary of the page.",
            imageUrl: "https://cdn.example.com/og.png",
            siteName: "Example",
          },
        ],
      }),
    });

    const card = screen.getByTestId("room-message-unfurl");
    expect(card).toHaveAttribute("href", "https://example.com/article");
    expect(card).toHaveAttribute("target", "_blank");
    expect(card).toHaveAttribute("rel", "noopener noreferrer");
    // Hug content (thumbnail / text); do not stretch muted background full row.
    expect(card).toHaveClass("inline-block", "w-fit", "max-w-full");
    expect(card).not.toHaveClass("w-full");
    expect(card).toHaveTextContent("Example");
    expect(card).toHaveTextContent("Example Article");
    expect(card).toHaveTextContent("A short summary of the page.");
    const unfurlImage = screen.getByRole("img", { name: /Example Article/ });
    expect(unfurlImage).toHaveAttribute(
      "src",
      "https://cdn.example.com/og.png",
    );
    // Keep intrinsic aspect ratio (do not force w-full + max-h + object-cover).
    expect(unfurlImage).toHaveClass("h-auto", "max-h-48", "max-w-full");
    expect(unfurlImage).not.toHaveClass("w-full", "object-cover");
    // Markdown body still present (links stay clickable in body).
    expect(screen.getByTestId("room-message-body")).toHaveTextContent(
      "Check https://example.com/article",
    );
  });

  it("omits unfurl cards when unfurls are null or empty", () => {
    const { rerender } = render(
      <ChatMessageRow
        message={userMessage({ unfurls: null })}
        coworkersById={new Map()}
        coworkersBySlug={new Map()}
        onToggleReaction={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("room-message-unfurls"),
    ).not.toBeInTheDocument();

    rerender(
      <ChatMessageRow
        message={userMessage({ unfurls: [] })}
        coworkersById={new Map()}
        coworkersBySlug={new Map()}
        onToggleReaction={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("room-message-unfurls"),
    ).not.toBeInTheDocument();
  });

  it("keeps file chips unchanged when unfurls are present", () => {
    renderRow({
      message: userMessage({
        content:
          "[report.pdf](https://files.example.com/report.pdf)\n\nand https://example.com",
        unfurls: [
          {
            url: "https://example.com",
            title: "Example",
            description: null,
            imageUrl: null,
            siteName: null,
          },
        ],
      }),
    });

    expect(
      screen.getByTestId("room-message-attachment-row"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("chip")).toHaveTextContent("report.pdf");
    expect(screen.getByTestId("room-message-unfurl")).toHaveTextContent(
      "Example",
    );
  });
});

describe("ChatMessageRow coworker Thought", () => {
  it("shows Beautiful UI loading on mention status while coworker is thinking", () => {
    renderRow({
      message: userMessage({
        content: "@Noodles which org has the most members?",
        createdAt: new Date("2026-08-10T12:00:00.000Z"),
        mentions: [
          {
            id: "mention-1",
            coworkerId: "cow-1",
            status: "sent",
            responseMessageId: null,
          },
        ],
      }),
      coworkersById: new Map([
        [
          "cow-1",
          {
            id: "cow-1",
            name: "Noodles",
            slug: "noodles",
            caption: null,
            image: null,
            presence: "online",
          },
        ],
      ]),
    });

    const loading = screen.getByTestId("coworker-loading-state");
    expect(loading).toHaveTextContent("MentionStatus.sent");
    expect(screen.getByTestId("live-stream-elapsed")).toBeInTheDocument();
  });

  it("hides mention status when coworker replied; shows failed terminal only", () => {
    const coworkersById = new Map([
      [
        "cow-1",
        {
          id: "cow-1",
          name: "Noodles",
          slug: "noodles",
          caption: null,
          image: null,
          presence: "online" as const,
        },
      ],
    ]);
    const { rerender } = render(
      <ChatMessageRow
        message={userMessage({
          mentions: [
            {
              id: "m1",
              coworkerId: "cow-1",
              status: "responded",
              responseMessageId: "r1",
            },
          ],
        })}
        coworkersById={coworkersById}
        coworkersBySlug={new Map()}
        onToggleReaction={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("coworker-mention-terminal"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coworker-loading-state"),
    ).not.toBeInTheDocument();

    rerender(
      <ChatMessageRow
        message={userMessage({
          mentions: [
            {
              id: "m1",
              coworkerId: "cow-1",
              status: "failed",
              responseMessageId: null,
            },
          ],
        })}
        coworkersById={coworkersById}
        coworkersBySlug={new Map()}
        onToggleReaction={vi.fn()}
      />,
    );
    const terminal = screen.getByTestId("coworker-mention-terminal");
    expect(terminal).toHaveAttribute("role", "status");
    expect(terminal).toHaveTextContent("MentionStatus.failed");
    expect(terminal).toHaveClass("bg-destructive/10", "border-destructive/20");
    expect(
      screen.getByTestId("coworker-mention-failed-icon"),
    ).toBeInTheDocument();
    // Soft chip replaces the frozen pixel-grid loader.
    expect(screen.queryByTestId("bui-static-grid")).not.toBeInTheDocument();
  });

  it("shows Beautiful UI loading state on empty stream overlay", () => {
    renderRow({
      message: coworkerMessage({
        id: "stream:asst-1",
        content: "",
        metadata: { streaming: true },
      }),
    });

    expect(screen.getByTestId("coworker-loading-state")).toHaveTextContent(
      "reasoning.thinking",
    );
    expect(screen.getByTestId("live-stream-elapsed")).toBeInTheDocument();
  });

  it("shows working Thought trace with live beat on stream overlay", () => {
    renderRow({
      message: coworkerMessage({
        id: "stream:asst-2",
        content: "",
        metadata: {
          streaming: true,
          reasoning: [
            {
              type: "reasoning",
              text: "Counting registrations in last 30 days",
            },
          ],
        },
      }),
    });

    const trace = screen.getByTestId("coworker-thought-trace");
    expect(trace).toHaveAttribute("data-working", "true");
    expect(trace).toHaveTextContent("reasoning.thinking");
    const body = screen.getByTestId("coworker-thought-body");
    expect(body).toHaveTextContent("Counting registrations in last 30 days");
    expect(body.className).toMatch(/line-clamp-3/);
    expect(screen.getByTestId("live-stream-elapsed")).toBeInTheDocument();
  });

  it("shows tenths elapsed on the live Loading row", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:10.000Z"));
    try {
      renderRow({
        message: coworkerMessage({
          id: "stream:asst-elapsed",
          content: "",
          createdAt: new Date("2026-08-10T12:00:00.000Z"),
          metadata: { streaming: true },
        }),
      });
      expect(screen.getByTestId("live-stream-elapsed")).toHaveTextContent(
        "10.0s",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows collapsed Thought disclosure with duration when metadata has Thought", async () => {
    const user = userEvent.setup();
    renderRow({
      message: coworkerMessage({
        content: "There were 142 new registrations.",
        metadata: {
          reasoning: [{ type: "reasoning", text: "Queried user table." }],
          thought_timing_ms: { start: 1_000, end: 64_000 },
        },
      }),
    });

    expect(
      screen.getByText("There were 142 new registrations."),
    ).toBeInTheDocument();

    const toggle = screen.getByRole("button", {
      name: "Thought for 1m 3s",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("coworker-thought-body")).not.toBeVisible();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("coworker-thought-body")).toBeVisible();
    expect(screen.getByTestId("coworker-thought-body")).toHaveTextContent(
      "Queried user table.",
    );
  });

  it("uses expand label when Thought exists without valid timing", () => {
    renderRow({
      message: coworkerMessage({
        content: "Answer body",
        metadata: {
          reasoning: [{ type: "reasoning", text: "Some thought" }],
        },
      }),
    });

    expect(
      screen.getByRole("button", { name: /reasoning.expandSteps/i }),
    ).toBeInTheDocument();
  });

  it("omits Thought disclosure when there is no reasoning metadata", () => {
    renderRow({
      message: coworkerMessage({ content: "Plain answer" }),
    });

    expect(
      screen.queryByTestId("coworker-thought-trace"),
    ).not.toBeInTheDocument();
  });
});

describe("ChatMessageRow outbound delivery", () => {
  it("shows a clock in the timestamp slot while pending", () => {
    renderRow({
      currentUserId: "user-1",
      message: userMessage({
        id: "pending:turn-1",
        content: "on the train",
        metadata: {
          client_message_id: "turn-1",
          outbound_delivery_status: "pending",
        },
      }),
    });

    expect(screen.getByTestId("outbound-delivery-pending")).toBeTruthy();
    expect(screen.getByLabelText("Outbound.sending")).toBeTruthy();
    expect(screen.queryByTestId("outbound-delivery-failed")).toBeNull();
  });

  it("shows a brief check in the timestamp slot right after confirm", () => {
    renderRow({
      currentUserId: "user-1",
      message: userMessage({ id: "srv-1", content: "on the train" }),
      showOutboundSentTick: true,
    });

    expect(screen.getByTestId("outbound-delivery-sent")).toBeTruthy();
    expect(screen.getByLabelText("Outbound.sent")).toBeTruthy();
  });

  it("shows wall-clock time once the sent tick window ends", () => {
    renderRow({
      currentUserId: "user-1",
      message: userMessage({ id: "srv-1", content: "on the train" }),
    });

    expect(screen.queryByTestId("outbound-delivery-pending")).toBeNull();
    expect(screen.queryByTestId("outbound-delivery-sent")).toBeNull();
    expect(screen.getByText("on the train")).toBeTruthy();
  });

  it("shows Retry and Remove for a failed send", async () => {
    const user = userEvent.setup();
    const onRetryOutbound = vi.fn();
    const onRemoveOutbound = vi.fn();
    const message = userMessage({
      id: "pending:turn-1",
      content: "on the train",
      metadata: {
        client_message_id: "turn-1",
        outbound_delivery_status: "failed",
      },
    });

    renderRow({
      currentUserId: "user-1",
      message,
      onRetryOutbound,
      onRemoveOutbound,
    });

    expect(screen.getByTestId("outbound-delivery-failed-icon")).toBeTruthy();
    expect(screen.getByTestId("outbound-delivery-failed")).toHaveTextContent(
      "Outbound.failed",
    );
    await user.click(screen.getByRole("button", { name: "Outbound.retry" }));
    expect(onRetryOutbound).toHaveBeenCalledWith(message);
    await user.click(screen.getByRole("button", { name: "Outbound.remove" }));
    expect(onRemoveOutbound).toHaveBeenCalledWith(message);
  });
});
