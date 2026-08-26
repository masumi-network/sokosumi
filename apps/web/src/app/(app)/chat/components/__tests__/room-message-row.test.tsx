import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { copyMock } = vi.hoisted(() => ({
  copyMock: vi.fn().mockResolvedValue(undefined),
}));

import { OUTBOUND_PENDING_SPINNER_DELAY_MS } from "@/app/chat/utils/outbound-room-message";
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
      if (key === "remove" && values) {
        return `Remove link preview: ${values.title}`;
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

vi.mock("@/hooks/use-clipboard", () => ({
  copyTextWithToast: copyMock,
  useClipboard: () => ({
    copied: false,
    copy: copyMock,
    reset: vi.fn(),
  }),
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
  onPin,
  showPinButton,
  currentUserId,
  onStartEdit,
  onDelete,
  onRemoveUnfurl,
  onRetryOutbound,
  onRetryMention,
  onRemoveOutbound,
  showOutboundSentTick = false,
  isEditing = false,
  editDraft = "",
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  isSavingEdit = false,
  coworkersById = new Map(),
  reserveHoverActionGutter,
}: {
  message?: ChatRoomMessage;
  isContinuation?: boolean;
  isFirstOfDay?: boolean;
  reserveHoverActionGutter?: boolean;
  onQuote?: (message: ChatRoomMessage) => void;
  onPin?: (message: ChatRoomMessage) => void;
  showPinButton?: boolean;
  currentUserId?: string;
  onStartEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  onRemoveUnfurl?: (message: ChatRoomMessage, url: string) => void;
  onRetryOutbound?: (message: ChatRoomMessage) => void;
  onRetryMention?: (message: ChatRoomMessage) => void;
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
      onPin={onPin}
      showPinButton={showPinButton}
      onStartEdit={onStartEdit}
      onDelete={onDelete}
      onRemoveUnfurl={onRemoveUnfurl}
      onRetryOutbound={onRetryOutbound}
      onRetryMention={onRetryMention}
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
      reserveHoverActionGutter={reserveHoverActionGutter}
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

  it("omits wall-clock time on continuation rows (group header time is enough)", () => {
    renderRow({ isContinuation: true });

    expect(screen.queryByRole("time")).not.toBeInTheDocument();
    const rail = screen.getByTestId("message-continuation-rail");
    // Same 2rem rail as size-8 avatar keeps body text aligned.
    expect(rail).toHaveClass("w-8", "min-w-8", "max-w-8");
  });

  it("omits wall-clock in the continuation rail while pending before spinner delay", () => {
    vi.useFakeTimers();
    try {
      const createdAt = new Date();
      renderRow({
        isContinuation: true,
        currentUserId: "user-1",
        message: userMessage({
          id: "pending:turn-1",
          content: "on the train",
          createdAt,
          metadata: {
            client_message_id: "turn-1",
            outbound_delivery_status: "pending",
          },
        }),
      });

      expect(screen.queryByTestId("outbound-delivery-pending")).toBeNull();
      expect(screen.queryByRole("time")).not.toBeInTheDocument();
      expect(
        screen.getByTestId("message-continuation-rail"),
      ).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(OUTBOUND_PENDING_SPINNER_DELAY_MS - 1);
      });
      expect(screen.queryByTestId("outbound-delivery-pending")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

  it("shows Copy in the message actions sheet", async () => {
    const user = userEvent.setup();
    renderRow({
      message: userMessage({ content: "Selectable chat body" }),
      onQuote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Actions.more" }));

    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Copy.action",
      }),
    ).toBeInTheDocument();
  });

  it("copies stored message content and closes the sheet", async () => {
    copyMock.mockClear();
    const user = userEvent.setup();
    renderRow({
      message: userMessage({ content: "**bold** body" }),
      onQuote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Actions.more" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Copy.action",
      }),
    );

    expect(copyMock).toHaveBeenCalledWith(
      "**bold** body",
      expect.objectContaining({
        copySuccessMessage: "Copy.success",
        copyErrorMessage: "Copy.error",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides Copy when the message has no copyable content", async () => {
    const user = userEvent.setup();
    renderRow({
      message: userMessage({ content: "   " }),
      onQuote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Actions.more" }));

    expect(
      within(screen.getByRole("dialog")).queryByRole("button", {
        name: "Copy.action",
      }),
    ).not.toBeInTheDocument();
  });

  it("hides Copy on a still-streaming overlay message", async () => {
    const user = userEvent.setup();
    renderRow({
      message: coworkerMessage({
        id: "stream:turn-1",
        content: "partial answer",
      }),
      onQuote: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Actions.more" }));

    expect(
      within(screen.getByRole("dialog")).queryByRole("button", {
        name: "Copy.action",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows Pin message on the hover action pill", () => {
    const onPin = vi.fn();
    renderRow({
      message: userMessage({ content: "Pin me" }),
      onPin,
      showPinButton: true,
    });

    const hoverActions = document.querySelector(
      '[data-message-actions="hover"]',
    );
    expect(hoverActions).toBeTruthy();
    fireEvent.click(
      within(hoverActions as HTMLElement).getByRole("button", {
        name: "PinnedMessages.pin",
      }),
    );
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  it("shows Copy on the hover action pill", () => {
    copyMock.mockClear();
    renderRow({
      message: userMessage({ content: "Hover copy body" }),
      onQuote: vi.fn(),
    });

    const hoverActions = document.querySelector(
      '[data-message-actions="hover"]',
    );
    expect(hoverActions).toBeTruthy();
    const hoverCopy = within(hoverActions as HTMLElement).getByRole("button", {
      name: "Copy.action",
    });
    fireEvent.click(hoverCopy);
    expect(copyMock).toHaveBeenCalledWith(
      "Hover copy body",
      expect.objectContaining({
        copySuccessMessage: "Copy.success",
        copyErrorMessage: "Copy.error",
      }),
    );
  });

  it("hides Copy when the message is deleted", () => {
    renderRow({
      currentUserId: "user-1",
      onDelete: vi.fn(),
      onQuote: vi.fn(),
      message: userMessage({
        content: "gone",
        deletedAt: new Date("2026-07-02T10:00:00.000Z"),
      }),
    });

    expect(
      screen.queryByRole("button", { name: "Copy.action" }),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-message-actions="hover"]'),
    ).not.toBeInTheDocument();
  });

  it("hides Copy while a coworker message is still thinking", () => {
    renderRow({
      message: coworkerMessage({
        id: "stream:asst-1",
        content: "",
        metadata: { streaming: true },
      }),
      onQuote: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: "Copy.action" }),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-message-actions="hover"]'),
    ).not.toBeInTheDocument();
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
    expect(article.className).toContain("[@media(hover:hover)]:pr-48");
    expect(article.className.split(/\s+/)).not.toContain("pr-48");
  });

  it("skips the hover action gutter so a narrow thread can use full width", () => {
    renderRow({ reserveHoverActionGutter: false });

    const article = screen.getByRole("article");
    expect(article.className).not.toContain("pr-48");
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

  it("linkifies membership-visible channel names in the body", () => {
    render(
      <ChatMessageRow
        message={userMessage({ content: "see #general please" })}
        coworkersById={new Map()}
        coworkersBySlug={new Map()}
        channelLinks={[
          {
            name: "general",
            slug: "general",
            href: "/chat/rooms/room-general",
          },
        ]}
        onToggleReaction={vi.fn()}
      />,
    );

    const body = screen.getByTestId("room-message-body");
    expect(body.textContent).toContain("[#general](/chat/rooms/room-general)");
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

  it("hides the unfurl card when the preview image fails and there is no description", () => {
    renderRow({
      message: userMessage({
        content: "https://youtube.com/watch?v=1",
        unfurls: [
          {
            url: "https://youtube.com/watch?v=1",
            title: "Watch",
            description: null,
            imageUrl: "https://cdn.example.com/broken.jpg",
            siteName: "YouTube",
          },
        ],
      }),
    });

    fireEvent.error(
      screen.getByRole("img", { name: "Preview image for Watch" }),
    );

    expect(screen.queryByTestId("room-message-unfurl")).not.toBeInTheDocument();
  });

  it("shows a replacement thumbnail after a later scrape when the first image failed", () => {
    const coworkersById = new Map();
    const coworkersBySlug = new Map();
    const first = userMessage({
      content: "https://youtube.com/watch?v=1",
      unfurls: [
        {
          url: "https://youtube.com/watch?v=1",
          title: "Watch",
          description: null,
          imageUrl: "https://cdn.example.com/broken.jpg",
          siteName: "YouTube",
        },
      ],
    });

    const { rerender } = render(
      <ChatMessageRow
        message={first}
        coworkersById={coworkersById}
        coworkersBySlug={coworkersBySlug}
        onToggleReaction={vi.fn()}
      />,
    );

    fireEvent.error(
      screen.getByRole("img", { name: "Preview image for Watch" }),
    );
    expect(screen.queryByTestId("room-message-unfurl")).not.toBeInTheDocument();

    rerender(
      <ChatMessageRow
        message={{
          ...first,
          unfurls: [
            {
              url: "https://youtube.com/watch?v=1",
              title: "Watch",
              description: null,
              imageUrl: "https://cdn.example.com/ok.jpg",
              siteName: "YouTube",
            },
          ],
        }}
        coworkersById={coworkersById}
        coworkersBySlug={coworkersBySlug}
        onToggleReaction={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Preview image for Watch" }),
    ).toHaveAttribute("src", "https://cdn.example.com/ok.jpg");
  });

  it("keeps the unfurl card when the preview image fails and a description remains", () => {
    renderRow({
      message: userMessage({
        content: "https://example.com/article",
        unfurls: [
          {
            url: "https://example.com/article",
            title: "Example Article",
            description: "A short summary of the page.",
            imageUrl: "https://cdn.example.com/broken.jpg",
            siteName: "Example",
          },
        ],
      }),
    });

    fireEvent.error(
      screen.getByRole("img", { name: "Preview image for Example Article" }),
    );

    const card = screen.getByTestId("room-message-unfurl");
    expect(card).toHaveTextContent("Example Article");
    expect(card).toHaveTextContent("A short summary of the page.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("omits title-only unfurl cards that have no image and no description", () => {
    renderRow({
      message: userMessage({
        content: "Check [Sentry](https://masumi.sentry.io)",
        unfurls: [
          {
            url: "https://masumi.sentry.io",
            title: "Sign In | Sentry",
            description: null,
            imageUrl: null,
            siteName: "masumi.sentry.io",
          },
          {
            url: "https://resend.com",
            title: "Resend",
            description: "  ",
            imageUrl: null,
            siteName: "resend.com",
          },
        ],
      }),
    });

    expect(
      screen.queryByTestId("room-message-unfurls"),
    ).not.toBeInTheDocument();
  });

  it("renders only unfurls that have an image or a description", () => {
    renderRow({
      message: userMessage({
        content:
          "See [Sentry](https://masumi.sentry.io) and https://example.com/article",
        unfurls: [
          {
            url: "https://masumi.sentry.io",
            title: "Sign In | Sentry",
            description: null,
            imageUrl: null,
            siteName: "masumi.sentry.io",
          },
          {
            url: "https://example.com/article",
            title: "Example Article",
            description: "A short summary of the page.",
            imageUrl: null,
            siteName: "Example",
          },
        ],
      }),
    });

    const cards = screen.getAllByTestId("room-message-unfurl");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("Example Article");
    expect(cards[0]).toHaveTextContent("A short summary of the page.");
    expect(screen.queryByText("Sign In | Sentry")).not.toBeInTheDocument();
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
            description: "Example description",
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

  it("shows a remove control on each unfurl for the author", () => {
    renderRow({
      currentUserId: "user-1",
      onRemoveUnfurl: vi.fn(),
      message: userMessage({
        content: "Check https://ably.com https://resend.com",
        unfurls: [
          {
            url: "https://ably.com",
            title: "Ably",
            description: "Realtime messaging",
            imageUrl: null,
            siteName: "Ably",
          },
          {
            url: "https://resend.com",
            title: "Resend",
            description: "Email for developers",
            imageUrl: null,
            siteName: "Resend",
          },
        ],
      }),
    });

    expect(
      screen.getByRole("button", { name: "Remove link preview: Ably" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove link preview: Resend" }),
    ).toBeInTheDocument();
  });

  it("places the unfurl remove control on the card corner and only on that card's hover", () => {
    renderRow({
      currentUserId: "user-1",
      onRemoveUnfurl: vi.fn(),
      message: userMessage({
        content: "Check https://ably.com",
        unfurls: [
          {
            url: "https://ably.com",
            title: "Ably",
            description: "Realtime messaging",
            imageUrl: null,
            siteName: "Ably",
          },
        ],
      }),
    });

    const button = screen.getByRole("button", {
      name: "Remove link preview: Ably",
    });
    expect(button.parentElement?.className).toContain("group/unfurl");
    expect(button.className).toContain("group-hover/unfurl:");
    expect(button.className).not.toMatch(
      /(^|\s)\[@media\(hover:hover\)\]:group-hover:/,
    );
    expect(button.className).toContain("translate-x-1/2");
    expect(button.className).toContain("-translate-y-1/2");
  });

  it("does not show unfurl remove for another member", () => {
    renderRow({
      currentUserId: "user-2",
      onRemoveUnfurl: vi.fn(),
      message: userMessage({
        content: "Check https://example.com",
        unfurls: [
          {
            url: "https://example.com",
            title: "Example",
            description: "Example description",
            imageUrl: null,
            siteName: "Example",
          },
        ],
      }),
    });

    expect(
      screen.queryByRole("button", { name: /Remove link preview/ }),
    ).not.toBeInTheDocument();
  });

  it("does not show unfurl remove on a coworker-authored message", () => {
    renderRow({
      currentUserId: "user-1",
      onRemoveUnfurl: vi.fn(),
      message: coworkerMessage({
        content: "Check https://example.com",
        unfurls: [
          {
            url: "https://example.com",
            title: "Example",
            description: "Example description",
            imageUrl: null,
            siteName: "Example",
          },
        ],
      }),
    });

    expect(screen.getByTestId("room-message-unfurl")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Remove link preview/ }),
    ).not.toBeInTheDocument();
  });

  it("calls onRemoveUnfurl with that card URL and does not open a confirm dialog", async () => {
    const user = userEvent.setup();
    const onRemoveUnfurl = vi.fn();
    const message = userMessage({
      content: "Check https://ably.com",
      unfurls: [
        {
          url: "https://ably.com",
          title: "Ably",
          description: "Realtime messaging",
          imageUrl: null,
          siteName: "Ably",
        },
      ],
    });

    renderRow({
      currentUserId: "user-1",
      onRemoveUnfurl,
      message,
    });

    await user.click(
      screen.getByRole("button", { name: "Remove link preview: Ably" }),
    );

    expect(onRemoveUnfurl).toHaveBeenCalledWith(message, "https://ably.com");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("ChatMessageRow coworker Thought", () => {
  it("does not show Calling on the parent while waiting for a Thought shell", () => {
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

    expect(
      screen.queryByTestId("coworker-loading-state"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coworker-mention-terminal"),
    ).not.toBeInTheDocument();
  });

  it("hides parent mention chrome once a Thought shell exists", () => {
    renderRow({
      message: userMessage({
        mentions: [
          {
            id: "mention-1",
            coworkerId: "cow-1",
            status: "sent",
            responseMessageId: "shell_1",
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

    expect(
      screen.queryByTestId("coworker-loading-state"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coworker-mention-terminal"),
    ).not.toBeInTheDocument();
  });

  it("never shows mention fail chrome on the parent message", () => {
    renderRow({
      message: userMessage({
        mentions: [
          {
            id: "m1",
            coworkerId: "cow-1",
            status: "failed",
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
    expect(
      screen.queryByTestId("coworker-mention-terminal"),
    ).not.toBeInTheDocument();
  });

  it("shows failed caption on the coworker shell with no elapsed clock", () => {
    renderRow({
      message: coworkerMessage({
        content: "",
        metadata: {
          mention_id: "mention_1",
          mention_failed: true,
        },
      }),
    });

    expect(screen.getByTestId("coworker-thought-sparkle")).toHaveTextContent(
      "MentionStatus.failed",
    );
    expect(screen.queryByTestId("live-stream-elapsed")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coworker-thought-trace"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coworker-mention-failed"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coworker-mention-retry"),
    ).not.toBeInTheDocument();
  });

  it("shows Retry on a failed mention shell for the mentioner", async () => {
    const user = userEvent.setup();
    const onRetryMention = vi.fn();
    const message = coworkerMessage({
      content: "",
      metadata: {
        mention_id: "mention_1",
        mention_failed: true,
        in_reply_to_message_id: "source-1",
      },
    });

    renderRow({ message, onRetryMention });

    expect(screen.getByTestId("coworker-thought-sparkle")).toHaveTextContent(
      "MentionStatus.failed",
    );
    await user.click(screen.getByTestId("coworker-mention-retry"));
    expect(onRetryMention).toHaveBeenCalledWith(message);
    expect(screen.getByTestId("coworker-mention-retry")).toHaveTextContent(
      "MentionStatus.retry",
    );
  });

  it("shows the Thought sparkle on empty stream overlay, not the pixel grid", () => {
    renderRow({
      message: coworkerMessage({
        id: "stream:asst-1",
        content: "",
        metadata: { streaming: true },
      }),
    });

    const trace = screen.getByTestId("coworker-thought-trace");
    expect(trace).toHaveAttribute("data-working", "true");
    expect(trace).toHaveTextContent("reasoning.thinking");
    expect(screen.getByTestId("live-stream-elapsed")).toBeInTheDocument();
    expect(
      screen.queryByTestId("coworker-loading-state"),
    ).not.toBeInTheDocument();
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
    expect(
      within(trace).getByTestId("live-stream-elapsed"),
    ).toBeInTheDocument();
  });

  it("stacks blank-line Thought beats and keeps elapsed on the header", () => {
    renderRow({
      message: coworkerMessage({
        id: "stream:asst-beats",
        content: "",
        metadata: {
          streaming: true,
          reasoning: [
            {
              type: "reasoning",
              text: "Analyzing the request...\n\nProcessing load skill results......",
            },
          ],
        },
      }),
    });

    const body = screen.getByTestId("coworker-thought-body");
    const steps = body.querySelectorAll("p");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent("Analyzing the request...");
    expect(steps[1]).toHaveTextContent("Processing load skill results......");
    expect(
      within(screen.getByTestId("coworker-thought-trace")).getByTestId(
        "live-stream-elapsed",
      ),
    ).toBeInTheDocument();
  });

  it("shows whole-second elapsed on the live Loading row from 10s", () => {
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
        "10s",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps stream overlay thinking elapsed across remount", () => {
    vi.useFakeTimers();
    const createdAt = new Date("2026-08-10T12:00:00.000Z");
    const message = coworkerMessage({
      id: "stream:asst-remount",
      content: "",
      createdAt,
      metadata: { streaming: true },
    });
    try {
      vi.setSystemTime(new Date("2026-08-10T12:00:45.000Z"));
      const { unmount } = render(
        <ChatMessageRow
          message={message}
          coworkersById={new Map()}
          coworkersBySlug={new Map()}
          onToggleReaction={vi.fn()}
        />,
      );
      expect(screen.getByTestId("live-stream-elapsed")).toHaveTextContent(
        "45s",
      );
      unmount();
      vi.setSystemTime(new Date("2026-08-10T12:01:05.000Z"));
      render(
        <ChatMessageRow
          message={message}
          coworkersById={new Map()}
          coworkersBySlug={new Map()}
          onToggleReaction={vi.fn()}
        />,
      );
      expect(screen.getByTestId("live-stream-elapsed")).toHaveTextContent(
        "1m 5s",
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
  it("keeps wall-clock time while pending before the spinner delay", () => {
    vi.useFakeTimers();
    try {
      const createdAt = new Date();
      renderRow({
        currentUserId: "user-1",
        message: userMessage({
          id: "pending:turn-1",
          content: "on the train",
          createdAt,
          metadata: {
            client_message_id: "turn-1",
            outbound_delivery_status: "pending",
          },
        }),
      });

      expect(screen.queryByTestId("outbound-delivery-pending")).toBeNull();
      expect(screen.getByRole("time")).toBeInTheDocument();
      expect(screen.queryByTestId("outbound-delivery-failed")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(OUTBOUND_PENDING_SPINNER_DELAY_MS - 1);
      });
      expect(screen.queryByTestId("outbound-delivery-pending")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a quiet spinner after the pending delay elapses", () => {
    vi.useFakeTimers();
    try {
      const createdAt = new Date();
      renderRow({
        currentUserId: "user-1",
        message: userMessage({
          id: "pending:turn-1",
          content: "on the train",
          createdAt,
          metadata: {
            client_message_id: "turn-1",
            outbound_delivery_status: "pending",
          },
        }),
      });

      expect(screen.queryByTestId("outbound-delivery-pending")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(screen.getByTestId("outbound-delivery-pending")).toBeTruthy();
      expect(
        screen.getByTestId("outbound-delivery-pending-spinner"),
      ).toBeTruthy();
      expect(screen.getByLabelText("Outbound.sending")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
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
