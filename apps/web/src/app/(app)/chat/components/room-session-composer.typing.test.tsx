import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  composeDraftKey,
  setComposeDraft,
} from "@/app/chat/utils/compose-draft-storage";

const handleComposerChangeSpy = vi.fn();
const handleStopTypingSpy = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "" }),
}));

vi.mock("@/components/markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/lib/utils/compose-upload.client", () => ({
  uploadComposeAttachments: vi.fn(),
}));

// DriveFilePicker calls useSession; the real session atom's unmount timer
// can fire after happy-dom tears down `window`.
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Only the picker is stood in for — the real composer chrome still renders.
// Driving the actual popover would test Radix, not the typing wiring.
vi.mock("@/components/chat/room-message-composer", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/chat/room-message-composer")
    >();
  return {
    ...actual,
    RoomComposerEmojiPicker: ({
      onPick,
      ariaLabel,
    }: {
      onPick: (emoji: string) => void;
      ariaLabel: string;
    }) => (
      <button type="button" aria-label={ariaLabel} onClick={() => onPick("🎉")}>
        emoji
      </button>
    ),
  };
});

// Stand in for the link dialog so its Save can be reached without driving a
// Radix dialog. `handleLinkSave` is the third programmatic-insert path.
vi.mock("@/components/chat/composer-add-link-dialog", () => ({
  ComposerAddLinkDialog: ({
    onSave,
  }: {
    onSave: (text: string, url: string) => void;
  }) => (
    <button
      aria-label="save-link"
      onClick={() => onSave("Ably", "https://ably.com")}
      type="button"
    >
      save link
    </button>
  ),
}));

vi.mock("@/lib/ably/use-room-typing", () => ({
  useRoomTyping: () => ({
    typistIds: [],
    handleComposerChange: handleComposerChangeSpy,
    handleStopTyping: handleStopTypingSpy,
  }),
}));

import { RoomSessionComposer } from "./room-session-composer";
import { RoomTypingProvider } from "./room-typing-provider";

const ROOM_ID = "room-typing";
const DRAFT_KEY = composeDraftKey.room(ROOM_ID);

function renderComposer(onSend = vi.fn().mockResolvedValue({ ok: true })) {
  render(
    <RoomTypingProvider roomId={ROOM_ID} currentUserId="user_me">
      <RoomSessionComposer
        roomId={ROOM_ID}
        draftKey={DRAFT_KEY}
        mentions={{}}
        placeholder="Message"
        pendingQuote={null}
        isSending={false}
        onSend={onSend}
      />
    </RoomTypingProvider>,
  );
  return { onSend };
}

async function typeInto(editor: HTMLElement, text: string) {
  await act(async () => {
    editor.focus();
    editor.innerHTML = text;
    fireEvent.input(editor);
  });
}

describe("RoomSessionComposer typing", () => {
  beforeEach(() => {
    window.localStorage.clear();
    handleComposerChangeSpy.mockClear();
    handleStopTypingSpy.mockClear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("announces typing when the person types", async () => {
    renderComposer();
    const editor = await screen.findByRole("textbox");

    await typeInto(editor, "hello");

    expect(handleComposerChangeSpy).toHaveBeenCalledWith(true);
  });

  it("reports an emptied composer rather than staying silent", async () => {
    renderComposer();
    const editor = await screen.findByRole("textbox");

    await typeInto(editor, "hello");
    handleComposerChangeSpy.mockClear();
    await typeInto(editor, "");

    expect(handleComposerChangeSpy).toHaveBeenCalledWith(false);
  });

  it("stops typing when the message is sent", async () => {
    const { onSend } = renderComposer();
    const editor = await screen.findByRole("textbox");
    await typeInto(editor, "hello");

    const form = editor.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(handleStopTypingSpy).toHaveBeenCalled();
  });

  it("stops typing when the composer loses focus", async () => {
    renderComposer();
    const editor = await screen.findByRole("textbox");
    await typeInto(editor, "hello");

    await act(async () => {
      fireEvent.blur(editor);
      // The editor guards blur behind a short suggestion-dismiss delay.
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(handleStopTypingSpy).toHaveBeenCalled();
  });

  it("stays silent when the toolbar drops in an emoji", async () => {
    // Typing is about text the person typed, so it never lies: an emoji the
    // picker inserted is not a keystroke (ADR-0033).
    renderComposer();
    await screen.findByRole("textbox");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Toolbar.emoji"));
    });

    expect(handleComposerChangeSpy).not.toHaveBeenCalled();
  });

  it("still announces typing that follows an inserted emoji", async () => {
    renderComposer();
    const editor = await screen.findByRole("textbox");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Toolbar.emoji"));
    });
    await typeInto(editor, "🎉 hello");

    expect(handleComposerChangeSpy).toHaveBeenCalledWith(true);
  });

  it("still hears the next keystroke when a toolbar insert produced nothing", async () => {
    // The flag is one-shot. If the insert fails or no-ops it never gets
    // claimed, and a flag left set would swallow the next genuine keystroke.
    renderComposer();
    const editor = await screen.findByRole("textbox");

    await act(async () => {
      // Announce an insert, then never produce a change from it.
      screen
        .getByLabelText("Toolbar.emoji")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    handleComposerChangeSpy.mockClear();

    await typeInto(editor, "hello");

    expect(handleComposerChangeSpy).toHaveBeenCalledWith(true);
  });

  it("stays silent when the toolbar inserts a link", async () => {
    // Third programmatic-insert path after the emoji picker and quote-restore:
    // the app put that text there, not the person (ADR-0033).
    renderComposer();
    await screen.findByRole("textbox");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("save-link"));
    });

    expect(handleComposerChangeSpy).not.toHaveBeenCalled();
  });

  it("stays silent when a Draft is restored on open", async () => {
    setComposeDraft(DRAFT_KEY, { text: "abandoned draft", attachments: [] });
    renderComposer();
    const editor = await screen.findByRole("textbox");

    await waitFor(() => {
      expect(editor.textContent).toContain("abandoned draft");
    });

    expect(handleComposerChangeSpy).not.toHaveBeenCalled();
  });
});
