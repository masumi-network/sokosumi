import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  ComposerWysiwygEditor,
  type ComposerWysiwygEditorHandle,
} from "@/components/chat/composer-wysiwyg-editor";

const getPopupPositionFromRect = vi.hoisted(() =>
  vi.fn(() => ({
    top: 400,
    left: 80,
    side: "top" as const,
    maxHeight: 120,
  })),
);

vi.mock("@/components/ui/mention-textarea-utils", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/ui/mention-textarea-utils")
    >();
  return {
    ...actual,
    getPopupPositionFromRect,
  };
});

describe("ComposerWysiwygEditor", () => {
  it("applies top-side flip and dynamic maxHeight to the mention listbox", () => {
    function Harness() {
      const editorRef = useRef<ComposerWysiwygEditorHandle>(null);
      const [value, setValue] = useState("");
      return (
        <>
          <button
            type="button"
            onClick={() => editorRef.current?.openMentions()}
          >
            open-mentions
          </button>
          <ComposerWysiwygEditor
            ref={editorRef}
            value={value}
            onChange={setValue}
            mentions={{
              alice: { value: "Alice" },
              bob: { value: "Bob" },
            }}
          />
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "open-mentions" }));

    const listbox = screen.getByRole("listbox");
    expect(listbox).toHaveStyle({
      maxHeight: "120px",
      transform: "translateY(-100%)",
    });
    expect(getPopupPositionFromRect).toHaveBeenCalled();
  });

  it("submits on plain Enter on desktop and newlines on Shift+Enter", () => {
    const onSubmitShortcut = vi.fn();

    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
          onSubmitShortcut={onSubmitShortcut}
        />
      );
    }

    render(<Harness />);

    const editor = screen.getByRole("textbox");
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);
  });

  it("opens link shortcut on Cmd+K", () => {
    const onLinkShortcut = vi.fn();

    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
          onLinkShortcut={onLinkShortcut}
        />
      );
    }

    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "k",
      metaKey: true,
    });
    expect(onLinkShortcut).toHaveBeenCalledTimes(1);
  });
});
