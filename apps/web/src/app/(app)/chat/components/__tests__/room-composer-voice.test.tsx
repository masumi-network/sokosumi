import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  type FormEvent,
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useState,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomComposer, type RoomComposerAttachment } from "../room-composer";

const uploadComposeAttachments = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "" }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/utils/compose-upload.client", () => ({
  uploadComposeAttachments,
}));

vi.mock("@/components/chat/composer-wysiwyg-editor", () => ({
  ComposerWysiwygEditor: ({
    ref,
    onSubmitShortcut,
  }: {
    ref?: Ref<unknown>;
    onSubmitShortcut?: () => void;
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
    return (
      <button type="button" onClick={onSubmitShortcut}>
        enter
      </button>
    );
  },
}));

vi.mock("@/components/chat/room-message-composer", () => ({
  ROOM_COMPOSER_TEXTAREA_CLASSNAME: "",
  ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME: "",
  RoomComposerEmojiPicker: () => null,
  RoomMessageComposer: ({
    children,
    toolbarStart,
    sendDisabled,
    onSubmit,
    formRef,
  }: {
    children?: ReactNode;
    toolbarStart?: ReactNode;
    sendDisabled?: boolean;
    onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
    formRef?: Ref<HTMLFormElement>;
  }) => (
    <form ref={formRef} onSubmit={onSubmit}>
      {toolbarStart}
      {children}
      <button type="submit" disabled={sendDisabled}>
        send
      </button>
    </form>
  ),
}));

vi.mock("@/components/chat/voice-message-recorder", () => ({
  VoiceMessageRecorder: ({
    onRecorded,
    onRecordingChange,
  }: {
    onRecorded: (file: File) => void;
    onRecordingChange?: (recording: boolean) => void;
  }) => (
    <>
      <button type="button" onClick={() => onRecordingChange?.(true)}>
        record
      </button>
      <button
        type="button"
        onClick={() => {
          onRecordingChange?.(false);
          onRecorded(new File(["voice"], "voice.weba", { type: "audio/webm" }));
        }}
      >
        stop
      </button>
    </>
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

function Harness({
  onSubmit,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [attachments, setAttachments] = useState<RoomComposerAttachment[]>([]);
  return (
    <>
      <span data-testid="attachments">
        {attachments.map((item) => item.fileName).join(",")}
      </span>
      <RoomComposer
        value="hello"
        onValueChange={() => undefined}
        mentions={{}}
        onSelectedKeysChange={() => undefined}
        placeholder="Message"
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onSubmit={onSubmit}
        isSending={false}
        sendDisabled={false}
      />
    </>
  );
}

const uploaded = (files: File[]) =>
  files.map((file) => ({
    publicUrl: `https://blob.example/${file.name}`,
    fileName: file.name,
    mediaType: file.type,
    file,
  }));

describe("RoomComposer voice messages", () => {
  beforeEach(() => {
    uploadComposeAttachments.mockReset();
  });

  it("attaches a recording that finishes during another upload once it ends", async () => {
    let finishFirst: () => void = () => undefined;
    uploadComposeAttachments
      .mockImplementationOnce(
        (files: File[]) =>
          new Promise((resolve) => {
            finishFirst = () => resolve(uploaded(files));
          }),
      )
      .mockImplementation(async (files: File[]) => uploaded(files));
    const { container } = render(<Harness onSubmit={vi.fn()} />);

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("file input missing");
    fireEvent.change(input, {
      target: { files: [new File(["pdf"], "brief.pdf")] },
    });
    await waitFor(() =>
      expect(uploadComposeAttachments).toHaveBeenCalledOnce(),
    );

    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    await act(async () => {});
    expect(uploadComposeAttachments).toHaveBeenCalledOnce();

    await act(async () => finishFirst());
    await waitFor(() =>
      expect(screen.getByTestId("attachments")).toHaveTextContent(
        "brief.pdf,voice.weba",
      ),
    );
  });

  it("holds Send and Enter while recording", async () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    );
    uploadComposeAttachments.mockImplementation(async (files: File[]) =>
      uploaded(files),
    );
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "record" }));
    expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "enter" }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    await waitFor(() =>
      expect(screen.getByTestId("attachments")).toHaveTextContent("voice.weba"),
    );
    expect(screen.getByRole("button", { name: "send" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "enter" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
