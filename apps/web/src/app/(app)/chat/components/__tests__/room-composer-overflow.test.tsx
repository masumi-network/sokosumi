import { CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH } from "@sokosumi/utils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type FormEvent,
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useState,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomComposer, type RoomComposerAttachment } from "../room-composer";
import { ROOM_COMPOSER_OVERFLOW_MARKDOWN_FILENAME } from "../room-helpers";

const uploadComposeAttachments = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => "",
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/utils/compose-upload.client", () => ({
  uploadComposeAttachments,
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
  RoomMessageComposer: ({
    belowEditor,
    sendDisabled,
    onSubmit,
  }: {
    belowEditor?: ReactNode;
    sendDisabled?: boolean;
    onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  }) => (
    <form onSubmit={onSubmit}>
      {belowEditor}
      <button type="submit" disabled={sendDisabled}>
        send
      </button>
    </form>
  ),
}));

vi.mock("@/components/chat/composer-format-toolbar", () => ({
  ComposerFormatToolbar: () => null,
}));

vi.mock("@/components/chat/composer-add-link-dialog", () => ({
  ComposerAddLinkDialog: () => null,
}));

vi.mock("@/components/drive/drive-file-picker", () => ({
  DriveFilePicker: () => null,
}));

vi.mock("@/components/drive/attachment-submenu", () => ({
  AttachmentSubmenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const TOO_LONG = "a".repeat(CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH + 1);

function OverflowHarness({
  allowAttachments = true,
  initialValue,
  onSubmit,
}: {
  allowAttachments?: boolean;
  initialValue: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [attachments, setAttachments] = useState<RoomComposerAttachment[]>([]);
  return (
    <>
      <span data-testid="value-length">{String(value.length)}</span>
      <span data-testid="attachment-count">{String(attachments.length)}</span>
      <RoomComposer
        value={value}
        onValueChange={setValue}
        mentions={{}}
        onSelectedKeysChange={() => undefined}
        placeholder="Message"
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onSubmit={onSubmit}
        isSending={false}
        sendDisabled={false}
        allowAttachments={allowAttachments}
      />
    </>
  );
}

describe("RoomComposer over-limit recovery", () => {
  beforeEach(() => {
    uploadComposeAttachments.mockReset();
  });

  it("shows the too-long error and no file recovery when attachments are off", () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });
    render(
      <OverflowHarness
        allowAttachments={false}
        initialValue={TOO_LONG}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("composerTooLong");
    expect(
      screen.queryByRole("button", { name: "composerAttachAsMarkdownFile" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
  });

  it("offers markdown file recovery, attaches on click, and does not send", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });
    uploadComposeAttachments.mockImplementation(async (files: File[]) =>
      files.map((file) => ({
        publicUrl: `https://blob.example/${file.name}`,
        fileName: file.name,
        mediaType: file.type || null,
        file,
      })),
    );

    render(<OverflowHarness initialValue={TOO_LONG} onSubmit={onSubmit} />);

    expect(screen.getByRole("alert")).toHaveTextContent("composerTooLong");
    const recover = screen.getByRole("button", {
      name: "composerAttachAsMarkdownFile",
    });
    expect(screen.getByRole("button", { name: "send" })).toBeDisabled();

    await user.click(recover);

    await waitFor(() => {
      expect(uploadComposeAttachments).toHaveBeenCalledTimes(1);
    });
    const uploadedFiles = uploadComposeAttachments.mock.calls[0]?.[0] as File[];
    expect(uploadedFiles).toHaveLength(1);
    expect(uploadedFiles[0]?.name).toBe(
      ROOM_COMPOSER_OVERFLOW_MARKDOWN_FILENAME,
    );
    expect(uploadedFiles[0]?.type).toBe("text/markdown");

    await waitFor(() => {
      expect(screen.getByTestId("value-length")).toHaveTextContent("0");
    });
    expect(screen.getByTestId("attachment-count")).toHaveTextContent("1");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "composerAttachAsMarkdownFile" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "send" })).toBeEnabled();
  });

  it("keeps the draft when file recovery upload fails", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });
    uploadComposeAttachments.mockRejectedValue(new Error("upload failed"));

    render(<OverflowHarness initialValue={TOO_LONG} onSubmit={onSubmit} />);

    await user.click(
      screen.getByRole("button", { name: "composerAttachAsMarkdownFile" }),
    );

    await waitFor(() => {
      expect(uploadComposeAttachments).toHaveBeenCalled();
    });
    expect(screen.getByTestId("value-length")).toHaveTextContent(
      String(TOO_LONG.length),
    );
    expect(screen.getByTestId("attachment-count")).toHaveTextContent("0");
    expect(screen.getByRole("alert")).toHaveTextContent("composerTooLong");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
