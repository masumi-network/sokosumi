import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CHAT_MOBILE_COMPOSER_SAFE_AREA_PB } from "@/app/chat/components/chat-mobile-tab-registry";

import { RoomMessageComposer } from "../room-message-composer";

vi.mock("@/components/chat/emoji-picker", () => ({
  EmojiPicker: () => null,
}));

const keyboardOpen = vi.hoisted(() => ({ current: false }));

vi.mock("@/hooks/use-keyboard-open", () => ({
  useKeyboardOpen: () => keyboardOpen.current,
}));

describe("RoomMessageComposer safe-area padding", () => {
  it("keeps mobile safe-area pb on focus when the keyboard is not open", async () => {
    keyboardOpen.current = false;
    const user = userEvent.setup();
    const { container } = render(
      <RoomMessageComposer
        onSubmit={(event) => event.preventDefault()}
        attachments={[]}
        onRemoveAttachment={() => undefined}
        removeAttachmentLabel={(name) => name}
        isSending={false}
        sendDisabled={false}
        sendAriaLabel="Send"
        withSafeAreaPadding
      >
        <textarea aria-label="message" />
      </RoomMessageComposer>,
    );

    const form = container.querySelector("form");
    expect(form?.className).toContain(CHAT_MOBILE_COMPOSER_SAFE_AREA_PB);

    await user.click(screen.getByLabelText("message"));

    expect(form?.className).toContain(CHAT_MOBILE_COMPOSER_SAFE_AREA_PB);
  });

  it("drops mobile safe-area pb when the keyboard is open", () => {
    keyboardOpen.current = true;
    const { container } = render(
      <RoomMessageComposer
        onSubmit={(event) => event.preventDefault()}
        attachments={[]}
        onRemoveAttachment={() => undefined}
        removeAttachmentLabel={(name) => name}
        isSending={false}
        sendDisabled={false}
        sendAriaLabel="Send"
        withSafeAreaPadding
      >
        <textarea aria-label="message" />
      </RoomMessageComposer>,
    );

    expect(container.querySelector("form")?.className).not.toContain(
      CHAT_MOBILE_COMPOSER_SAFE_AREA_PB,
    );
  });
});
