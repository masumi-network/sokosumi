import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { useComposerExternalValueSync } from "./use-composer-external-value-sync";

function Probe({ value, isInternal }: { value: string; isInternal?: boolean }) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const isInternalChange = useRef(Boolean(isInternal));
  isInternalChange.current = Boolean(isInternal);
  useComposerExternalValueSync({
    editorRef,
    isInternalChange,
    value,
    channels: [],
    resolveMentionDisplay: (_key, slug) => ({
      displayName: slug,
      isKnown: false,
    }),
  });
  return (
    <div
      ref={editorRef}
      data-testid="editor"
      contentEditable
      suppressContentEditableWarning
    />
  );
}

describe("useComposerExternalValueSync", () => {
  it("hydrates external markdown into the editor DOM, skips focused internal edits, and applies external clears", () => {
    const { getByTestId, rerender, unmount } = render(
      <Probe value="Hello world" />,
    );
    const editor = getByTestId("editor");
    expect(editor.innerHTML).toContain("Hello world");

    // Internal non-empty updates leave DOM untouched.
    editor.innerHTML = "Edited locally";
    rerender(<Probe value="Hello world 2" isInternal={true} />);
    expect(editor.innerHTML).toBe("Edited locally");

    // External clear always wins even when isInternalChange is true.
    rerender(<Probe value="" isInternal={true} />);
    expect(editor.innerHTML).toBe("");

    unmount();
  });
});
