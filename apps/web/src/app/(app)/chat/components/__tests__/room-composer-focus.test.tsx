import { act, render, waitFor } from "@testing-library/react";
import {
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { describe, expect, it, vi } from "vitest";

import {
  RoomComposer,
  type RoomComposerHandle,
} from "@/app/chat/components/room-composer";

const editorFocus = vi.hoisted(() => vi.fn());

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function FocusHarness({ focusOnMount = false }: { focusOnMount?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <RoomComposer
      value={value}
      onValueChange={setValue}
      mentions={{}}
      onSelectedKeysChange={() => undefined}
      placeholder="Message"
      attachments={[]}
      onAttachmentsChange={() => undefined}
      onSubmit={(event) => event.preventDefault()}
      isSending={false}
      sendDisabled={false}
      showMentionShortcut={false}
      allowAttachments={false}
      focusOnMount={focusOnMount}
    />
  );
}

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
      focus: () => {
        editorFocus();
      },
      insertText: () => undefined,
      openMentions: () => undefined,
      applyFormat: () => undefined,
      insertLink: () => undefined,
      getSelectedPlainText: () => "",
    }));
    return <div role="textbox" />;
  },
}));

vi.mock("@/components/chat/room-message-composer", () => ({
  ROOM_COMPOSER_TEXTAREA_CLASSNAME: "",
  ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME: "",
  RoomComposerEmojiPicker: () => null,
  RoomMessageComposer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/chat/composer-format-toolbar", () => ({
  ComposerFormatToolbar: () => null,
}));

vi.mock("@/components/chat/composer-add-link-dialog", () => ({
  ComposerAddLinkDialog: () => null,
}));

describe("RoomComposerHandle.focus", () => {
  it("exposes focus and calling it focuses the editor", async () => {
    editorFocus.mockClear();

    function Harness() {
      const composerRef = useRef<RoomComposerHandle | null>(null);
      const [value, setValue] = useState("");
      return (
        <>
          <button type="button" onClick={() => composerRef.current?.focus()}>
            focus-composer
          </button>
          <RoomComposer
            ref={composerRef}
            value={value}
            onValueChange={setValue}
            mentions={{}}
            onSelectedKeysChange={() => undefined}
            placeholder="Message"
            attachments={[]}
            onAttachmentsChange={() => undefined}
            onSubmit={(event) => event.preventDefault()}
            isSending={false}
            sendDisabled={false}
            showMentionShortcut={false}
            allowAttachments={false}
          />
        </>
      );
    }

    const { getByRole } = render(<Harness />);
    await waitFor(() => {
      expect(getByRole("textbox")).toBeInTheDocument();
    });

    getByRole("button", { name: "focus-composer" }).click();
    expect(editorFocus).toHaveBeenCalledTimes(1);
  });

  it("still exposes attachFiles on the handle", async () => {
    function Probe() {
      const composerRef = useRef<RoomComposerHandle | null>(null);
      const [value, setValue] = useState("");
      const [ready, setReady] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setReady(
                typeof composerRef.current?.attachFiles === "function" &&
                  typeof composerRef.current?.focus === "function",
              );
            }}
          >
            probe
          </button>
          <span data-testid="ready">{ready ? "yes" : "no"}</span>
          <RoomComposer
            ref={composerRef}
            value={value}
            onValueChange={setValue}
            mentions={{}}
            onSelectedKeysChange={() => undefined}
            placeholder="Message"
            attachments={[]}
            onAttachmentsChange={() => undefined}
            onSubmit={(event) => event.preventDefault()}
            isSending={false}
            sendDisabled={false}
            showMentionShortcut={false}
            allowAttachments={false}
          />
        </>
      );
    }

    const { getByRole, getByTestId } = render(<Probe />);
    await waitFor(() => {
      expect(getByRole("textbox")).toBeInTheDocument();
    });
    getByRole("button", { name: "probe" }).click();
    await waitFor(() => {
      expect(getByTestId("ready").textContent).toBe("yes");
    });
  });
});

describe("RoomComposer focusOnMount", () => {
  it("focuses the editor once after mount via rAF when focusOnMount", async () => {
    editorFocus.mockClear();
    render(<FocusHarness focusOnMount />);

    expect(editorFocus).not.toHaveBeenCalled();
    await flushAnimationFrame();
    await waitFor(() => {
      expect(editorFocus).toHaveBeenCalledTimes(1);
    });
  });

  it("does not autofocus when focusOnMount is omitted", async () => {
    editorFocus.mockClear();
    render(<FocusHarness />);

    await flushAnimationFrame();
    expect(editorFocus).not.toHaveBeenCalled();
  });

  it("focuses when focusOnMount flips false → true (progressive history ready)", async () => {
    editorFocus.mockClear();

    function FlipHarness() {
      const [focusOnMount, setFocusOnMount] = useState(false);
      const [value, setValue] = useState("");
      return (
        <>
          <button type="button" onClick={() => setFocusOnMount(true)}>
            enable-focus
          </button>
          <RoomComposer
            value={value}
            onValueChange={setValue}
            mentions={{}}
            onSelectedKeysChange={() => undefined}
            placeholder="Message"
            attachments={[]}
            onAttachmentsChange={() => undefined}
            onSubmit={(event) => event.preventDefault()}
            isSending={false}
            sendDisabled={false}
            showMentionShortcut={false}
            allowAttachments={false}
            focusOnMount={focusOnMount}
          />
        </>
      );
    }

    const { getByRole } = render(<FlipHarness />);
    await flushAnimationFrame();
    expect(editorFocus).not.toHaveBeenCalled();

    await act(async () => {
      getByRole("button", { name: "enable-focus" }).click();
    });
    await flushAnimationFrame();
    await waitFor(() => {
      expect(editorFocus).toHaveBeenCalledTimes(1);
    });
  });
});
