import { CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH } from "@sokosumi/utils";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  composeDraftKey,
  getComposeDraft,
  setComposeDraft,
} from "@/app/chat/utils/compose-draft-storage";
import type { PendingRoomQuote } from "./room-helpers";
import { RoomSessionComposer } from "./room-session-composer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => "",
  }),
}));

vi.mock("@/components/markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/utils/compose-upload.client", () => ({
  uploadComposeAttachments: vi.fn(),
}));

describe("RoomSessionComposer draft clear on send", () => {
  const roomId = "room-draft-clear";
  const draftKey = composeDraftKey.room(roomId);

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("clears composer value and localStorage draft after successful send", async () => {
    setComposeDraft(draftKey, {
      text: "typing indicators please",
      attachments: [],
    });

    const onSend = vi.fn().mockResolvedValue({ ok: true });

    render(
      <RoomSessionComposer
        roomId={roomId}
        draftKey={draftKey}
        mentions={{}}
        placeholder="Message"
        pendingQuote={null}
        isSending={false}
        onSend={onSend}
      />,
    );

    const editor = await screen.findByRole("textbox");
    await waitFor(() => {
      expect(editor.textContent).toContain("typing indicators please");
    });

    const form = editor.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(editor.textContent ?? "").toBe("");
    });
    expect(getComposeDraft(draftKey)).toBeNull();
    expect(window.localStorage.getItem(draftKey)).toBeNull();
  });

  it("does not leave draft in localStorage when send succeeds after typing", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });

    render(
      <RoomSessionComposer
        roomId={roomId}
        draftKey={draftKey}
        mentions={{}}
        placeholder="Message"
        pendingQuote={null}
        isSending={false}
        onSend={onSend}
      />,
    );

    const editor = await screen.findByRole("textbox");
    await act(async () => {
      editor.focus();
      editor.innerHTML = "typing indicators please";
      fireEvent.input(editor);
    });

    await waitFor(() => {
      expect(editor.textContent).toContain("typing indicators please");
    });

    const form = editor.closest("form");
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(editor.textContent ?? "").toBe("");
      expect(getComposeDraft(draftKey)).toBeNull();
    });
  });

  it("restores composer when send fails", async () => {
    const onSend = vi.fn().mockResolvedValue({
      ok: false,
      message: "failed",
    });

    render(
      <RoomSessionComposer
        roomId={roomId}
        draftKey={draftKey}
        mentions={{}}
        placeholder="Message"
        pendingQuote={null}
        isSending={false}
        onSend={onSend}
      />,
    );

    const editor = await screen.findByRole("textbox");
    await act(async () => {
      editor.focus();
      editor.innerHTML = "typing indicators please";
      fireEvent.input(editor);
    });

    fireEvent.submit(editor.closest("form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(editor.textContent).toContain("typing indicators please");
    });
  });

  it("clears editor when submit lands in the same act as the last input", async () => {
    setComposeDraft(draftKey, {
      text: "typing indicators please",
      attachments: [],
    });
    const onSend = vi.fn().mockResolvedValue({ ok: true });

    render(
      <RoomSessionComposer
        roomId={roomId}
        draftKey={draftKey}
        mentions={{}}
        placeholder="Message"
        pendingQuote={null}
        isSending={false}
        onSend={onSend}
      />,
    );

    const editor = await screen.findByRole("textbox");
    await waitFor(() => {
      expect(editor.textContent).toContain("typing indicators please");
    });
    const form = editor.closest("form");
    expect(form).not.toBeNull();

    await act(async () => {
      editor.focus();
      fireEvent.input(editor);
      fireEvent.submit(form!);
    });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(editor.textContent ?? "").toBe("");
    });
    expect(getComposeDraft(draftKey)).toBeNull();
  });

  it("keeps editor focused after send clears the draft", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });

    render(
      <RoomSessionComposer
        roomId={roomId}
        draftKey={draftKey}
        mentions={{}}
        placeholder="Message"
        pendingQuote={null}
        isSending={false}
        onSend={onSend}
      />,
    );

    const editor = await screen.findByRole("textbox");
    await act(async () => {
      editor.focus();
      editor.innerHTML = "keep the keyboard";
      fireEvent.input(editor);
    });

    expect(editor).toHaveFocus();
    fireEvent.submit(editor.closest("form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(editor.textContent ?? "").toBe("");
    });
    expect(document.activeElement).toBe(editor);
  });

  it("keeps the draft and explains why send failed when content is over the max", async () => {
    const { toast } = await import("sonner");
    const tooLong = "a".repeat(CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH + 1);
    setComposeDraft(draftKey, {
      text: tooLong,
      attachments: [],
    });
    const onSend = vi.fn();

    render(
      <RoomSessionComposer
        roomId={roomId}
        draftKey={draftKey}
        mentions={{}}
        placeholder="Message"
        pendingQuote={null}
        isSending={false}
        onSend={onSend}
      />,
    );

    const editor = await screen.findByRole("textbox");
    await waitFor(() => {
      expect(editor.textContent?.length).toBe(tooLong.length);
    });

    fireEvent.submit(editor.closest("form")!);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("composerTooLong");
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(editor.textContent).toBe(tooLong);
    expect(getComposeDraft(draftKey)?.text).toBe(tooLong);
  });
});

describe("RoomSessionComposer pasted Message link", () => {
  const roomId = "room-paste";
  const draftKey = composeDraftKey.room(roomId);
  const link = `${window.location.origin}/chat/rooms/room-source?message=msg-1`;
  const quote = {
    messageId: "msg-1",
    authorName: "Alice",
    snippet: "Earlier point about launch risk",
    attachment: null,
    roomId: "room-source",
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  function pasteText(editor: HTMLElement, text: string) {
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? text : ""),
      },
    });
  }

  function Harness({
    onSend,
    onResolveMessageLink,
    draftKey: harnessDraftKey = draftKey,
  }: {
    draftKey?: string;
    onSend: ComponentProps<typeof RoomSessionComposer>["onSend"];
    onResolveMessageLink: ComponentProps<
      typeof RoomSessionComposer
    >["onResolveMessageLink"];
  }) {
    const [pendingQuote, setPendingQuote] = useState<PendingRoomQuote | null>(
      null,
    );
    return (
      <RoomSessionComposer
        roomId={roomId}
        draftKey={harnessDraftKey}
        mentions={{}}
        placeholder="Message"
        pendingQuote={pendingQuote}
        onClearPendingQuote={() => setPendingQuote(null)}
        onSetPendingQuote={setPendingQuote}
        onResolveMessageLink={onResolveMessageLink}
        isSending={false}
        onSend={onSend}
      />
    );
  }

  it("offers a quote, and accepting sends the quote instead of the link", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    const onResolveMessageLink = vi.fn().mockResolvedValue(quote);
    render(
      <Harness onSend={onSend} onResolveMessageLink={onResolveMessageLink} />,
    );

    const editor = await screen.findByRole("textbox");
    editor.focus();
    pasteText(editor, link);

    expect(onResolveMessageLink).toHaveBeenCalledWith({
      roomId: "room-source",
      messageId: "msg-1",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "pasteOffer.accept" }),
    );

    await waitFor(() => {
      expect(editor.textContent ?? "").not.toContain("/chat/rooms/");
    });
    expect(screen.getByText("Earlier point about launch risk")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "pasteOffer.accept" }),
    ).toBeNull();

    await act(async () => {
      editor.innerHTML = "see this";
      fireEvent.input(editor);
    });
    fireEvent.submit(editor.closest("form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({
      content: "see this",
      quote: { messageId: "msg-1", roomId: "room-source" },
    });
  });

  it("restores the text and the quote when the send fails", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: false });
    render(
      <Harness
        onSend={onSend}
        onResolveMessageLink={vi.fn().mockResolvedValue(quote)}
      />,
    );

    const editor = await screen.findByRole("textbox");
    editor.focus();
    pasteText(editor, link);
    fireEvent.click(
      await screen.findByRole("button", { name: "pasteOffer.accept" }),
    );
    await act(async () => {
      editor.innerHTML = "see this";
      fireEvent.input(editor);
    });
    fireEvent.submit(editor.closest("form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(editor.textContent).toContain("see this");
    });
    expect(screen.getByText("Earlier point about launch risk")).toBeTruthy();
  });

  it("does not offer a message that is already the pending quote", async () => {
    const onResolveMessageLink = vi.fn().mockResolvedValue(quote);
    render(
      <Harness onSend={vi.fn()} onResolveMessageLink={onResolveMessageLink} />,
    );

    const editor = await screen.findByRole("textbox");
    editor.focus();
    pasteText(editor, link);
    fireEvent.click(
      await screen.findByRole("button", { name: "pasteOffer.accept" }),
    );
    await screen.findByText("Earlier point about launch risk");

    pasteText(editor, link);

    await waitFor(() => {
      expect(editor.textContent).toContain(link);
    });
    expect(onResolveMessageLink).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "pasteOffer.accept" }),
    ).toBeNull();
  });

  it("keeps the plain link when the offer is declined", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    render(
      <Harness
        onSend={onSend}
        onResolveMessageLink={vi.fn().mockResolvedValue(quote)}
      />,
    );

    const editor = await screen.findByRole("textbox");
    editor.focus();
    pasteText(editor, link);
    fireEvent.click(
      await screen.findByRole("button", { name: "pasteOffer.decline" }),
    );

    expect(
      screen.queryByRole("button", { name: "pasteOffer.accept" }),
    ).toBeNull();
    fireEvent.submit(editor.closest("form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend.mock.calls[0]?.[0].content).toContain(link);
    expect(onSend.mock.calls[0]?.[0].quote).toBeUndefined();
  });

  it("withdraws the offer once the link is no longer in the body", async () => {
    render(
      <Harness
        onSend={vi.fn()}
        onResolveMessageLink={vi.fn().mockResolvedValue(quote)}
      />,
    );

    const editor = await screen.findByRole("textbox");
    editor.focus();
    pasteText(editor, link);
    await screen.findByRole("button", { name: "pasteOffer.accept" });

    await act(async () => {
      editor.innerHTML = "never mind";
      fireEvent.input(editor);
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "pasteOffer.accept" }),
      ).toBeNull();
    });
  });

  it("does not carry the offer into another room or thread", async () => {
    const props = {
      onSend: vi.fn(),
      onResolveMessageLink: vi.fn().mockResolvedValue(quote),
    };
    const { rerender } = render(<Harness {...props} />);

    const editor = await screen.findByRole("textbox");
    editor.focus();
    pasteText(editor, link);
    await screen.findByRole("button", { name: "pasteOffer.accept" });

    rerender(<Harness {...props} draftKey={composeDraftKey.room("other")} />);

    expect(
      screen.queryByRole("button", { name: "pasteOffer.accept" }),
    ).toBeNull();
  });

  it("shows no offer when the link cannot become a quote", async () => {
    const onResolveMessageLink = vi.fn().mockResolvedValue(null);
    render(
      <Harness onSend={vi.fn()} onResolveMessageLink={onResolveMessageLink} />,
    );

    const editor = await screen.findByRole("textbox");
    editor.focus();
    pasteText(editor, link);

    await waitFor(() => {
      expect(onResolveMessageLink).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByRole("button", { name: "pasteOffer.accept" }),
    ).toBeNull();
    expect(editor.textContent).toContain(link);
  });

  it("does not resolve pasted text that is not exactly one Message link", async () => {
    const onResolveMessageLink = vi.fn();
    render(
      <Harness onSend={vi.fn()} onResolveMessageLink={onResolveMessageLink} />,
    );

    const editor = await screen.findByRole("textbox");
    editor.focus();
    pasteText(editor, `look at ${link}`);
    pasteText(editor, "https://example.com/chat/rooms/r?message=m");

    expect(onResolveMessageLink).not.toHaveBeenCalled();
  });
});
