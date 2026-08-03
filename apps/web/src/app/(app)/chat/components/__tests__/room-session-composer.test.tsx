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
  getComposeDraft,
  setComposeDraft,
} from "@/app/chat/utils/compose-draft-storage";

import { RoomSessionComposer } from "../room-session-composer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
});
