import { fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import { RoomMessageComposer } from "../room-message-composer";

vi.mock("@/components/chat/emoji-picker", () => ({
  EmojiPicker: () => null,
}));

vi.mock("@/hooks/use-keyboard-open", () => ({
  useKeyboardOpen: () => false,
}));

describe("RoomMessageComposer send pointer path", () => {
  it("submits on pointerdown without blurring the editor", () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });
    const onPrepareSubmit = vi.fn();

    render(
      <RoomMessageComposer
        onSubmit={onSubmit}
        onPrepareSubmit={onPrepareSubmit}
        attachments={[]}
        onRemoveAttachment={() => undefined}
        removeAttachmentLabel={(name) => name}
        isSending={false}
        sendDisabled={false}
        sendAriaLabel="Send"
      >
        <div role="textbox" contentEditable tabIndex={0} />
      </RoomMessageComposer>,
    );

    const editor = screen.getByRole("textbox");
    editor.focus();
    expect(document.activeElement).toBe(editor);

    const send = screen.getByRole("button", { name: "Send" });
    fireEvent.pointerDown(send, { button: 0 });

    expect(onPrepareSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(editor);

    // Follow-up click must not double-submit.
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not submit when send is disabled", () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });

    render(
      <RoomMessageComposer
        onSubmit={onSubmit}
        attachments={[]}
        onRemoveAttachment={() => undefined}
        removeAttachmentLabel={(name) => name}
        isSending={false}
        sendDisabled
        sendAriaLabel="Send"
      >
        <div role="textbox" contentEditable tabIndex={0} />
      </RoomMessageComposer>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Send" }), {
      button: 0,
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
