import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ComposerWysiwygEditor } from "@/components/chat/composer-wysiwyg-editor";

describe("ComposerWysiwygEditor", () => {
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
