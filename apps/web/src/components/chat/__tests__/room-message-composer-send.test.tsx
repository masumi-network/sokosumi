import { fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MENTION_ANCHOR_SCROLL_MARGIN_TOP_PX } from "@/components/ui/mention-textarea-utils";

import {
  ROOM_COMPOSER_MENTION_ANCHOR_ATTR,
  RoomMessageComposer,
} from "../room-message-composer";

vi.mock("@/components/chat/emoji-picker", () => ({
  EmojiPicker: () => null,
}));

vi.mock("@/hooks/use-keyboard-open", () => ({
  useKeyboardOpen: () => false,
}));

describe("RoomMessageComposer send pointer path", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function SendHarness({ withSubmitControl }: { withSubmitControl: boolean }) {
    return (
      <RoomMessageComposer
        onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
        attachments={[]}
        onRemoveAttachment={() => undefined}
        removeAttachmentLabel={(name) => name}
        isSending={false}
        sendDisabled={false}
        sendAriaLabel="Send"
        submitControl={
          withSubmitControl ? <button type="button">Stop</button> : undefined
        }
      >
        <div role="textbox" contentEditable tabIndex={0} />
      </RoomMessageComposer>
    );
  }

  it("preventDefaults touchstart on Send so iOS keeps the editor focused", () => {
    render(<SendHarness withSubmitControl={false} />);

    const send = screen.getByRole("button", { name: "Send" });

    // iOS blurs the editor on the touch, not on the compatibility mouse event,
    // so pointerdown's preventDefault cannot hold it. fireEvent returns false
    // when the listener called preventDefault.
    expect(fireEvent.touchStart(send)).toBe(false);
  });

  it("still submits exactly once on a full touch gesture", () => {
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
        sendDisabled={false}
        sendAriaLabel="Send"
      >
        <div role="textbox" contentEditable tabIndex={0} />
      </RoomMessageComposer>,
    );

    const send = screen.getByRole("button", { name: "Send" });

    // The touchstart guard suppresses the synthesized click on iOS, so the
    // whole send path rests on pointerdown. One tap must still post once.
    fireEvent.touchStart(send);
    fireEvent.pointerDown(send, { button: 0 });
    fireEvent.touchEnd(send);

    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Should a browser still synthesize the click, it must not post twice.
    fireEvent.click(send, { detail: 1 });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps the touchstart guard when Send replaces a submitControl", () => {
    // Coworker DMs swap in a stop control while streaming. Send mounts fresh
    // when it clears, and the guard has to come back with it.
    const { rerender } = render(<SendHarness withSubmitControl={true} />);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();

    rerender(<SendHarness withSubmitControl={false} />);

    const send = screen.getByRole("button", { name: "Send" });
    expect(fireEvent.touchStart(send)).toBe(false);
  });

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

    // Follow-up pointer click (detail >= 1) must not double-submit.
    fireEvent.click(send, { detail: 1 });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits a later click-only tap after pointer submit disables then re-enables Send", () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });

    function Harness() {
      const [sendDisabled, setSendDisabled] = useState(false);
      return (
        <RoomMessageComposer
          onSubmit={(event) => {
            onSubmit(event);
            // Mimic draft clear: Send disables before the follow-up click.
            setSendDisabled(true);
          }}
          attachments={[]}
          onRemoveAttachment={() => undefined}
          removeAttachmentLabel={(name) => name}
          isSending={false}
          sendDisabled={sendDisabled}
          sendAriaLabel="Send"
        >
          <div role="textbox" contentEditable tabIndex={0} />
          <button type="button" onClick={() => setSendDisabled(false)}>
            re-enable
          </button>
        </RoomMessageComposer>
      );
    }

    render(<Harness />);

    const send = screen.getByRole("button", { name: "Send" });
    fireEvent.pointerDown(send, { button: 0 });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(send).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "re-enable" }));
    expect(send).not.toBeDisabled();

    vi.advanceTimersByTime(400);

    // After the same-gesture window, a click-only tap must send again.
    fireEvent.click(send, { detail: 1 });
    expect(onSubmit).toHaveBeenCalledTimes(2);
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

  it("submits on a pointer click when pointerdown never reached Send", () => {
    // iOS first-tap with OSK up: blur + safe-area jump can drop pointerdown
    // on the button. The leftover event is a pointer click (detail >= 1).
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
        sendDisabled={false}
        sendAriaLabel="Send"
      >
        <div role="textbox" contentEditable tabIndex={0} />
      </RoomMessageComposer>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }), {
      detail: 1,
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits a click-only tap at performance time zero", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);

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
        sendDisabled={false}
        sendAriaLabel="Send"
      >
        <div role="textbox" contentEditable tabIndex={0} />
      </RoomMessageComposer>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }), {
      detail: 1,
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("puts mention-picker scroll-margin on the mention-anchor shell", () => {
    render(
      <RoomMessageComposer
        onSubmit={(event) => event.preventDefault()}
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

    const shell = document.querySelector(
      `[${ROOM_COMPOSER_MENTION_ANCHOR_ATTR}]`,
    );
    expect(shell).toHaveStyle({
      scrollMarginTop: `${MENTION_ANCHOR_SCROLL_MARGIN_TOP_PX}px`,
    });
  });

  it("clusters toolbarEnd with Send on the trailing edge", () => {
    render(
      <RoomMessageComposer
        onSubmit={(event) => event.preventDefault()}
        attachments={[]}
        onRemoveAttachment={() => undefined}
        removeAttachmentLabel={(name) => name}
        isSending={false}
        sendDisabled={false}
        sendAriaLabel="Send"
        toolbarEnd={<span>9500/10000</span>}
      >
        <div role="textbox" contentEditable tabIndex={0} />
      </RoomMessageComposer>,
    );

    const send = screen.getByRole("button", { name: "Send" });
    const count = screen.getByText("9500/10000");
    expect(send.parentElement).toBe(count.parentElement);
    expect(
      count.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
