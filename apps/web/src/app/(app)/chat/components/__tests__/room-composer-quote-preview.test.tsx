import { render } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea";
import { RoomComposer } from "../room-composer";
import type { RoomMentionParticipant } from "../room-helpers";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => "",
  }),
}));

vi.mock("@/components/chat/composer-wysiwyg-editor", () => ({
  ComposerWysiwygEditor: ({
    ref,
  }: {
    ref?: Ref<{
      focus: () => void;
      insertText: (text: string) => void;
      openMentions: () => void;
      applyFormat: () => void;
      insertLink: () => void;
      getSelectedPlainText: () => string;
    }>;
  }) => {
    useImperativeHandle(ref, () => ({
      focus: () => undefined,
      insertText: () => undefined,
      openMentions: () => undefined,
      applyFormat: () => undefined,
      insertLink: () => undefined,
      getSelectedPlainText: () => "",
      flushTrailingEmoticon: () => undefined,
    }));
    return <div role="textbox" />;
  },
}));

vi.mock("@/components/chat/room-message-composer", () => ({
  ROOM_COMPOSER_TEXTAREA_CLASSNAME: "",
  ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME: "",
  RoomComposerEmojiPicker: () => null,
  RoomMessageComposer: ({ aboveEditor }: { aboveEditor?: ReactNode }) => (
    <div>{aboveEditor}</div>
  ),
}));

vi.mock("@/components/chat/composer-format-toolbar", () => ({
  ComposerFormatToolbar: () => null,
}));

vi.mock("@/components/chat/composer-add-link-dialog", () => ({
  ComposerAddLinkDialog: () => null,
}));

const coworkerMention: MentionRecordEntry<RoomMentionParticipant> = {
  value: "Elena",
  slug: "elena",
  data: {
    kind: "coworker",
    id: "cow_1",
    name: "Elena",
    slug: "elena",
    image: null,
  },
};

describe("RoomComposer quote preview mentions", () => {
  it("keeps sent mention Direct chips when the picker catalog is hidden", () => {
    const { container } = render(
      <RoomComposer
        value=""
        onValueChange={() => undefined}
        mentions={{ cow_1: coworkerMention }}
        onSelectedKeysChange={() => undefined}
        placeholder="Message"
        attachments={[]}
        onAttachmentsChange={() => undefined}
        onSubmit={(event) => event.preventDefault()}
        isSending={false}
        sendDisabled={false}
        showMentionShortcut={false}
        allowAttachments={false}
        pendingQuote={{
          messageId: "msg-1",
          authorName: "Ada",
          snippet: "@cow_1:elena please look",
          attachment: null,
        }}
        onClearPendingQuote={() => undefined}
        canOpenHumanDirect
      />,
    );

    const chip = container.querySelector(
      '[data-direct-kind="coworker"][data-direct-id="cow_1"]',
    );
    expect(chip).not.toBeNull();
    expect(chip).toHaveTextContent("@Elena");
  });

  it("chips a roster User mention omitted from the picker catalog", () => {
    const { container } = render(
      <RoomComposer
        value=""
        onValueChange={() => undefined}
        mentions={{}}
        usersById={
          new Map([["b0user", { id: "b0user", name: "Andreas Osberghaus" }]])
        }
        onSelectedKeysChange={() => undefined}
        placeholder="Message"
        attachments={[]}
        onAttachmentsChange={() => undefined}
        onSubmit={(event) => event.preventDefault()}
        isSending={false}
        sendDisabled={false}
        pendingQuote={{
          messageId: "msg-1",
          authorName: "Yves Bollinger",
          snippet: "@b0user:andreas-osberghaus please look",
          attachment: null,
        }}
        onClearPendingQuote={() => undefined}
      />,
    );

    const chip = container.querySelector(
      '[data-direct-kind="human"][data-direct-id="b0user"]',
    );
    expect(chip).not.toBeNull();
    expect(chip).toHaveTextContent("@Andreas Osberghaus");
    expect(container.textContent).not.toContain("@b0user:andreas-osberghaus");
  });
});
