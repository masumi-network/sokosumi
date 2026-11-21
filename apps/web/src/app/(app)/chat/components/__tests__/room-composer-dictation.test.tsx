import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  type FormEvent,
  type ReactNode,
  type Ref,
  useImperativeHandle,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomComposer } from "../room-composer";

const transcribeVoiceRecording = vi.hoisted(() => vi.fn());
const insertText = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "" }),
}));

vi.mock("sonner", () => ({ toast }));

vi.mock("@/lib/services/voice-transcription.browser", () => ({
  transcribeVoiceRecording,
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
      insertText,
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
    toolbarEnd,
    sendDisabled,
    onSubmit,
    formRef,
  }: {
    children?: ReactNode;
    toolbarEnd?: ReactNode;
    sendDisabled?: boolean;
    onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
    formRef?: Ref<HTMLFormElement>;
  }) => (
    <form ref={formRef} onSubmit={onSubmit}>
      {children}
      <span data-testid="beside-send">{toolbarEnd}</span>
      <button type="submit" disabled={sendDisabled}>
        send
      </button>
    </form>
  ),
}));

vi.mock("@/components/chat/dictation-button", () => ({
  DictationButton: ({
    onRecorded,
    onRecordingChange,
  }: {
    onRecorded: (file: File) => void;
    onRecordingChange?: (recording: boolean) => void;
  }) => (
    <>
      <button type="button" onClick={() => onRecordingChange?.(true)}>
        dictate
      </button>
      <button
        type="button"
        onClick={() => {
          onRecordingChange?.(false);
          onRecorded(
            new File(["voice"], "dictation.weba", { type: "audio/webm" }),
          );
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

function renderComposer({
  value = "hello",
  onSubmit = vi.fn(),
}: {
  value?: string;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
} = {}) {
  return render(
    <RoomComposer
      value={value}
      onValueChange={() => undefined}
      mentions={{}}
      placeholder="Message"
      attachments={[]}
      onAttachmentsChange={() => undefined}
      onSubmit={onSubmit}
      isSending={false}
      sendDisabled={false}
    />,
  );
}

describe("RoomComposer dictation", () => {
  beforeEach(() => {
    transcribeVoiceRecording.mockReset();
    transcribeVoiceRecording.mockResolvedValue("");
    insertText.mockReset();
    toast.mockReset();
    toast.error.mockReset();
  });

  it("sits beside Send, also where attachments are off", () => {
    renderComposer();
    expect(screen.getByTestId("beside-send")).toContainElement(
      screen.getByRole("button", { name: "dictate" }),
    );
  });

  it("holds Send and Enter while dictating and turning it into text", async () => {
    let finish: (text: string) => void = () => undefined;
    transcribeVoiceRecording.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    );
    renderComposer({ onSubmit });

    fireEvent.click(screen.getByRole("button", { name: "dictate" }));
    expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "enter" }));
    expect(onSubmit).not.toHaveBeenCalled();

    finish("ship it");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "send" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "enter" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("types dictation into the message, after a space", async () => {
    transcribeVoiceRecording.mockResolvedValue("move my 3pm to Friday");
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    await waitFor(() =>
      expect(insertText).toHaveBeenCalledWith(" move my 3pm to Friday"),
    );
  });

  it("types dictation without a space into an empty message", async () => {
    transcribeVoiceRecording.mockResolvedValue("hello there");
    renderComposer({ value: "" });

    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    await waitFor(() => expect(insertText).toHaveBeenCalledWith("hello there"));
  });

  it("says so when dictation hears nothing or fails", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("dictationEmpty"));

    transcribeVoiceRecording.mockRejectedValue(new Error("502"));
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("dictationFailed"),
    );
    expect(insertText).not.toHaveBeenCalled();
  });
});
