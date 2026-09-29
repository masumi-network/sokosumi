import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "@/app/tasks/components/markdown-editor";

// MarkdownEditor mounts DriveFilePicker, which calls useSession. The real
// better-auth session atom schedules a nanostores unmount timer that can fire
// after happy-dom tears down `window`.
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => "",
    number: (num: number) => num.toString(),
  }),
}));

function setCaretToEnd(element: HTMLElement): void {
  element.focus();
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function setCaretToStart(element: HTMLElement): void {
  element.focus();
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("MarkdownEditor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses bordered shell for field variant by default", () => {
    const { container } = render(
      <MarkdownEditor value="" onChange={vi.fn()} />,
    );
    const shell = container.firstElementChild;
    expect(shell).toHaveClass("rounded-md", "border");
    expect(shell).not.toHaveClass("border-0");
  });

  it("omits outer border for document variant", () => {
    const { container } = render(
      <MarkdownEditor value="" onChange={vi.fn()} variant="document" />,
    );
    const shell = container.firstElementChild;
    expect(shell).toHaveClass("rounded-none", "border-0");
    expect(shell).not.toHaveClass("rounded-md");
  });

  it("keeps the format strip on the field variant", () => {
    render(<MarkdownEditor value="Hello" onChange={vi.fn()} />);
    expect(screen.getByRole("toolbar", { name: "Format" })).toBeInTheDocument();
    expect(screen.getByTitle("Bold (Cmd+B)")).toBeInTheDocument();
    expect(screen.getByTitle("Clear formatting")).toBeInTheDocument();
  });

  it("hides format tools on the document variant until text is selected", () => {
    render(
      <MarkdownEditor
        value="Hello world"
        onChange={vi.fn()}
        variant="document"
      />,
    );
    expect(
      screen.queryByRole("toolbar", { name: "Format" }),
    ).not.toBeInTheDocument();
  });

  it("shows a floating format toolbar when document text is selected", async () => {
    const rect = {
      x: 40,
      y: 40,
      top: 40,
      left: 40,
      width: 80,
      height: 16,
      bottom: 56,
      right: 120,
      toJSON() {
        return this;
      },
    };
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      rect as DOMRect,
    );

    render(
      <MarkdownEditor
        value="Hello world"
        onChange={vi.fn()}
        variant="document"
      />,
    );

    const editor = screen.getByRole("textbox");
    await waitFor(() => {
      expect(editor).toHaveTextContent("Hello world");
    });

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(
        screen.getByRole("toolbar", { name: "Format" }),
      ).toBeInTheDocument();
    });
    expect(screen.getByTitle("Bold (Cmd+B)")).toBeInTheDocument();
    expect(screen.getByTitle("Clear formatting")).toBeInTheDocument();
  });

  it("clears bold formatting from the field toolbar without execCommand", async () => {
    const onChange = vi.fn();

    render(
      <MarkdownEditor value="**Hello**" onChange={onChange} variant="field" />,
    );

    const editor = screen.getByRole("textbox");
    await waitFor(() => {
      expect(editor.querySelector("strong, b")).not.toBeNull();
    });

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const clearButton = screen.getByTitle("Clear formatting");
    fireEvent.mouseDown(clearButton);
    fireEvent.click(clearButton);

    await waitFor(() => {
      const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
      expect(savedMarkdown).toBe("Hello");
      expect(savedMarkdown).not.toContain("**");
    });
  });

  it("clears bold formatting from the floating toolbar without execCommand", async () => {
    const onChange = vi.fn();
    const rect = {
      x: 40,
      y: 40,
      top: 40,
      left: 40,
      width: 80,
      height: 16,
      bottom: 56,
      right: 120,
      toJSON() {
        return this;
      },
    };
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      rect as DOMRect,
    );

    render(
      <MarkdownEditor
        value="**Hello**"
        onChange={onChange}
        variant="document"
      />,
    );

    const editor = screen.getByRole("textbox");
    await waitFor(() => {
      expect(editor.querySelector("strong, b")).not.toBeNull();
    });

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const clearButton = await screen.findByTitle("Clear formatting");
    fireEvent.mouseDown(clearButton);
    fireEvent.click(clearButton);

    await waitFor(() => {
      const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
      expect(savedMarkdown).toBe("Hello");
      expect(savedMarkdown).not.toContain("**");
    });
  });

  it("does not restore a stale selection for Cmd+B after the caret collapses", async () => {
    const rect = {
      x: 40,
      y: 40,
      top: 40,
      left: 40,
      width: 80,
      height: 16,
      bottom: 56,
      right: 120,
      toJSON() {
        return this;
      },
    };
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      rect as DOMRect,
    );
    if (!document.execCommand) {
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: vi.fn(),
      });
    }
    const execCommandSpy = vi
      .spyOn(document, "execCommand")
      .mockReturnValue(true);
    const addRangeSpy = vi.spyOn(Selection.prototype, "addRange");

    render(
      <MarkdownEditor
        value="Hello world"
        onChange={vi.fn()}
        variant="document"
      />,
    );

    const editor = screen.getByRole("textbox");
    await waitFor(() => {
      expect(editor).toHaveTextContent("Hello world");
    });

    const selection = window.getSelection();
    const highlight = document.createRange();
    highlight.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(highlight);
    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(
        screen.getByRole("toolbar", { name: "Format" }),
      ).toBeInTheDocument();
    });

    const caret = document.createRange();
    caret.selectNodeContents(editor);
    caret.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(caret);
    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(
        screen.queryByRole("toolbar", { name: "Format" }),
      ).not.toBeInTheDocument();
    });

    addRangeSpy.mockClear();
    fireEvent.keyDown(editor, { key: "b", metaKey: true });

    expect(execCommandSpy).toHaveBeenCalledWith("bold", false, undefined);
    expect(addRangeSpy).not.toHaveBeenCalled();
  });

  it("applies bold from the floating toolbar after restoring saved selection", async () => {
    const onChange = vi.fn();
    const rect = {
      x: 40,
      y: 40,
      top: 40,
      left: 40,
      width: 80,
      height: 16,
      bottom: 56,
      right: 120,
      toJSON() {
        return this;
      },
    };
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      rect as DOMRect,
    );
    if (!document.execCommand) {
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: vi.fn(),
      });
    }
    const execCommandSpy = vi
      .spyOn(document, "execCommand")
      .mockImplementation((command) => {
        if (command !== "bold") {
          return false;
        }

        const selection = window.getSelection();
        expect(selection?.isCollapsed).toBe(false);
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          return false;
        }

        const range = selection.getRangeAt(0);
        const bold = document.createElement("b");
        try {
          range.surroundContents(bold);
        } catch {
          return false;
        }
        return true;
      });

    render(
      <MarkdownEditor
        value="Hello world"
        onChange={onChange}
        variant="document"
      />,
    );

    const editor = screen.getByRole("textbox");
    await waitFor(() => {
      expect(editor).toHaveTextContent("Hello world");
    });

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(
        screen.getByRole("toolbar", { name: "Format" }),
      ).toBeInTheDocument();
    });

    const boldButton = screen.getByTitle("Bold (Cmd+B)");
    fireEvent.mouseDown(boldButton);
    fireEvent.click(boldButton);

    expect(execCommandSpy).toHaveBeenCalledWith("bold", false, undefined);
    await waitFor(() => {
      const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
      expect(savedMarkdown).toContain("**");
    });
  });

  it("sets data-empty when contentEditable is cleared to a lone br", async () => {
    const onChange = vi.fn();

    render(
      <MarkdownEditor
        value=""
        onChange={onChange}
        variant="document"
        placeholder="Add details"
      />,
    );

    const editor = screen.getByRole("textbox");
    editor.innerHTML = "<br>";
    fireEvent.input(editor);

    await waitFor(() => {
      expect(editor).toHaveAttribute("data-empty");
    });
    expect(editor).not.toHaveTextContent("Add details");
    expect(editor.className).not.toContain(
      "before:content-[attr(data-placeholder)]",
    );
    const placeholder = screen.getByText("Add details");
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder).toHaveClass("pointer-events-none");
  });

  it("marks the floating format toolbar as a task-form portal", async () => {
    const rect = {
      x: 40,
      y: 40,
      top: 40,
      left: 40,
      width: 80,
      height: 16,
      bottom: 56,
      right: 120,
      toJSON() {
        return this;
      },
    };
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      rect as DOMRect,
    );

    render(
      <MarkdownEditor
        value="Hello world"
        onChange={vi.fn()}
        variant="document"
      />,
    );

    const editor = screen.getByRole("textbox");
    await waitFor(() => {
      expect(editor).toHaveTextContent("Hello world");
    });

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const toolbar = await screen.findByRole("toolbar", { name: "Format" });
    expect(toolbar).toHaveAttribute("data-task-form-portal");
  });

  it("keeps the floating format toolbar hittable while a modal disables body pointer events", async () => {
    const rect = {
      x: 40,
      y: 40,
      top: 40,
      left: 40,
      width: 80,
      height: 16,
      bottom: 56,
      right: 120,
      toJSON() {
        return this;
      },
    };
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      rect as DOMRect,
    );

    render(
      <MarkdownEditor
        value="Hello world"
        onChange={vi.fn()}
        variant="document"
      />,
    );

    const editor = screen.getByRole("textbox");
    await waitFor(() => {
      expect(editor).toHaveTextContent("Hello world");
    });

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const toolbar = await screen.findByRole("toolbar", { name: "Format" });
    expect(toolbar).toHaveClass("pointer-events-auto");
    expect(toolbar).toHaveClass("cursor-pointer");
    expect(screen.getByTitle("Bold (Cmd+B)")).toHaveClass("cursor-pointer");
  });

  it("applies bold from a pointer click on the floating toolbar", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const rect = {
      x: 40,
      y: 40,
      top: 40,
      left: 40,
      width: 80,
      height: 16,
      bottom: 56,
      right: 120,
      toJSON() {
        return this;
      },
    };
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      rect as DOMRect,
    );
    if (!document.execCommand) {
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: vi.fn(),
      });
    }
    const execCommandSpy = vi
      .spyOn(document, "execCommand")
      .mockImplementation((command) => {
        if (command !== "bold") {
          return false;
        }

        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          return false;
        }

        const range = selection.getRangeAt(0);
        const bold = document.createElement("b");
        try {
          range.surroundContents(bold);
        } catch {
          return false;
        }
        return true;
      });

    render(
      <MarkdownEditor
        value="Hello world"
        onChange={onChange}
        variant="document"
      />,
    );

    const editor = screen.getByRole("textbox");
    await waitFor(() => {
      expect(editor).toHaveTextContent("Hello world");
    });

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const boldButton = await screen.findByTitle("Bold (Cmd+B)");
    await user.click(boldButton);

    expect(execCommandSpy).toHaveBeenCalledWith("bold", false, undefined);
    await waitFor(() => {
      const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
      expect(savedMarkdown).toContain("**");
    });
  });

  it("keeps attach on the field strip and off the document bubble", () => {
    const { rerender } = render(
      <MarkdownEditor
        value=""
        onChange={vi.fn()}
        onAttachClick={vi.fn()}
        attachLabel="Upload File"
      />,
    );
    expect(screen.getByLabelText("Upload File")).toBeInTheDocument();

    rerender(
      <MarkdownEditor
        value=""
        onChange={vi.fn()}
        variant="document"
        onAttachClick={vi.fn()}
        attachLabel="Upload File"
      />,
    );
    expect(screen.queryByLabelText("Upload File")).not.toBeInTheDocument();
  });

  it("disables Inter contextual alternates so ** markers stay aligned", () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveClass("markdown-compose-surface");
  });

  it("keeps mailto links with @ while rendering mentions", async () => {
    render(
      <MarkdownEditor
        value="[me](mailto:user@example.com)"
        onChange={vi.fn()}
        mentions={{
          "agent-1": { value: "Writer Agent" },
        }}
      />,
    );

    const editor = screen.getByRole("textbox");

    await waitFor(() => {
      const link = editor.querySelector("a");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "mailto:user@example.com");
      expect(link).toHaveTextContent("me");
    });

    expect(editor.querySelector("span[data-mention-key]")).toBeNull();
  });

  it("renders multiple mentions when loading an existing task", async () => {
    render(
      <MarkdownEditor
        value="@agent-1:writer-agent test @agent-2:weather-agent"
        onChange={vi.fn()}
        mentions={{
          "agent-1": { value: "Writer Agent" },
          "agent-2": { value: "Weather Agent" },
        }}
      />,
    );

    const editor = screen.getByRole("textbox");

    await waitFor(() => {
      const mentions = editor.querySelectorAll("span[data-mention-key]");
      expect(mentions).toHaveLength(2);
      expect(mentions[0]).toHaveTextContent("@Writer Agent");
      expect(mentions[1]).toHaveTextContent("@Weather Agent");
    });
  });

  it("normalizes persisted internal mention tokens on edit", async () => {
    render(
      <MarkdownEditor
        value="@@MENTION1@@ test @@MENTION2@@"
        onChange={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox");

    await waitFor(() => {
      const mentions = editor.querySelectorAll("span[data-mention-key]");
      expect(mentions).toHaveLength(2);
      expect(editor).not.toHaveTextContent("@@MENTION1@@");
      expect(editor).not.toHaveTextContent("@@MENTION2@@");
      expect(editor).toHaveTextContent("@unknown mention 1");
      expect(editor).toHaveTextContent("@unknown mention 2");
    });
  });

  it("keeps mention names containing replacement patterns", async () => {
    render(
      <MarkdownEditor
        value="@agent-1:price-agent"
        onChange={vi.fn()}
        mentions={{
          "agent-1": { value: "Price $& Agent" },
        }}
      />,
    );

    const editor = screen.getByRole("textbox");

    await waitFor(() => {
      const mention = editor.querySelector("span[data-mention-key='agent-1']");
      expect(mention).toHaveTextContent("@Price $& Agent");
      expect(editor).not.toHaveTextContent("@@MENTION_0@@");
    });
  });

  it("inserts newline with one Enter when mention dropdown is not visible", async () => {
    const onChange = vi.fn();

    render(
      <MarkdownEditor
        value=""
        onChange={onChange}
        mentions={{
          "agent-1": { value: "Writer Agent" },
        }}
      />,
    );

    const editor = screen.getByRole("textbox");
    editor.innerHTML = "@zz";
    setCaretToEnd(editor);
    fireEvent.input(editor);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    const callsBeforeEnter = onChange.mock.calls.length;
    const enterEvent = createEvent.keyDown(editor, { key: "Enter" });
    fireEvent(editor, enterEvent);
    expect(enterEvent.defaultPrevented).toBe(false);
    expect(onChange.mock.calls).toHaveLength(callsBeforeEnter);
  });

  it("uses Enter to select mention when dropdown is visible", async () => {
    const onChange = vi.fn();

    render(
      <MarkdownEditor
        value=""
        onChange={onChange}
        mentions={{
          "agent-1": { value: "Writer Agent" },
        }}
      />,
    );

    const editor = screen.getByRole("textbox");
    editor.innerHTML = "@w";
    setCaretToEnd(editor);
    fireEvent.input(editor);

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => {
      expect(
        editor.querySelector("span[data-mention-key='agent-1']"),
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(savedMarkdown).toContain("@agent-1:writer-agent");
  });

  it("uses Tab to select mention when dropdown is visible", async () => {
    const onChange = vi.fn();

    render(
      <MarkdownEditor
        value=""
        onChange={onChange}
        mentions={{
          "agent-1": { value: "Writer Agent" },
        }}
      />,
    );

    const editor = screen.getByRole("textbox");
    editor.innerHTML = "@w";
    setCaretToEnd(editor);
    fireEvent.input(editor);

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    fireEvent.keyDown(editor, { key: "Tab" });

    await waitFor(() => {
      expect(
        editor.querySelector("span[data-mention-key='agent-1']"),
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(savedMarkdown).toContain("@agent-1:writer-agent");
  });

  it("uses Ctrl+Enter to trigger submit shortcut without adding newline", () => {
    const onChange = vi.fn();
    const onSubmitShortcut = vi.fn();

    render(
      <MarkdownEditor
        value="Hello"
        onChange={onChange}
        onSubmitShortcut={onSubmitShortcut}
      />,
    );

    const editor = screen.getByRole("textbox");
    setCaretToEnd(editor);

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });

    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.querySelector("br")).toBeNull();
  });

  it("inserts newline on first Enter after moving caret away from mention trigger", async () => {
    const onChange = vi.fn();

    render(
      <MarkdownEditor
        value=""
        onChange={onChange}
        mentions={{
          "agent-1": { value: "Writer Agent" },
        }}
      />,
    );

    const editor = screen.getByRole("textbox");
    editor.innerHTML = "@w";
    setCaretToEnd(editor);
    fireEvent.input(editor);

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    setCaretToStart(editor);
    fireEvent.mouseUp(editor);
    const callsBeforeEnter = onChange.mock.calls.length;
    const enterEvent = createEvent.keyDown(editor, { key: "Enter" });
    fireEvent(editor, enterEvent);

    expect(enterEvent.defaultPrevented).toBe(false);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(editor.querySelector("span[data-mention-key='agent-1']")).toBeNull();
    expect(onChange.mock.calls).toHaveLength(callsBeforeEnter);
  });

  it("does not prevent native Enter when selection is temporarily missing", async () => {
    const onChange = vi.fn();

    render(<MarkdownEditor value="Hello" onChange={onChange} />);

    const editor = screen.getByRole("textbox");
    await waitFor(() => {
      expect(editor).toHaveTextContent("Hello");
    });

    const selection = window.getSelection();
    selection?.removeAllRanges();

    const callsBeforeEnter = onChange.mock.calls.length;
    const enterEvent = createEvent.keyDown(editor, { key: "Enter" });
    fireEvent(editor, enterEvent);

    expect(enterEvent.defaultPrevented).toBe(false);
    expect(onChange.mock.calls).toHaveLength(callsBeforeEnter);
  });

  it("keeps fenced code blocks on a new line when saving", async () => {
    const onChange = vi.fn();

    render(<MarkdownEditor value="" onChange={onChange} />);

    const editor = screen.getByRole("textbox");
    editor.innerHTML = "<div>Intro<pre><code>const x = 1;</code></pre></div>";
    fireEvent.input(editor);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(savedMarkdown).toContain("Intro\n```\nconst x = 1;\n```\n");
  });

  it("preserves code block language when saving", async () => {
    const onChange = vi.fn();

    render(<MarkdownEditor value="" onChange={onChange} />);

    const editor = screen.getByRole("textbox");
    editor.innerHTML = `<pre><code data-language="ts">const x = 1;</code></pre>`;
    fireEvent.input(editor);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(savedMarkdown).toContain("```ts\nconst x = 1;\n```\n");
  });

  it("serializes multiline code tags as fenced markdown", async () => {
    const onChange = vi.fn();

    render(<MarkdownEditor value="" onChange={onChange} />);

    const editor = screen.getByRole("textbox");
    editor.innerHTML = `<div><code>line 1<br>line 2</code></div>`;
    fireEvent.input(editor);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(savedMarkdown).toContain("```\nline 1\nline 2\n```\n");
  });

  it("keeps multiline code fences separated from preceding text", async () => {
    const onChange = vi.fn();

    render(<MarkdownEditor value="" onChange={onChange} />);

    const editor = screen.getByRole("textbox");
    editor.innerHTML = "<div>Intro<code>line 1<br>line 2</code></div>";
    fireEvent.input(editor);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(savedMarkdown).toContain("Intro\n```\nline 1\nline 2\n```\n");
    expect(savedMarkdown).not.toContain("Intro```");
  });

  it("preserves line breaks when code block uses div children", async () => {
    const onChange = vi.fn();

    render(<MarkdownEditor value="" onChange={onChange} />);

    const editor = screen.getByRole("textbox");
    editor.innerHTML =
      "<pre><code><div>line 1</div><div>line 2</div></code></pre>";
    fireEvent.input(editor);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(savedMarkdown).toContain("```\nline 1\nline 2\n```\n");
  });

  it("preserves the first newline for Chrome contentEditable div lines", async () => {
    const onChange = vi.fn();

    render(<MarkdownEditor value="" onChange={onChange} />);

    const editor = screen.getByRole("textbox");
    // Chrome Enter after the first line leaves bare text, then wraps later
    // lines in <div> — without a separator the first break becomes "testtest".
    editor.innerHTML = "test<div>test</div><div>test</div>";
    fireEvent.input(editor);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(savedMarkdown).toBe("test\ntest\ntest\n");
    expect(savedMarkdown).not.toContain("testtest");
  });

  it("preserves the first newline for paragraph-wrapped lines", async () => {
    const onChange = vi.fn();

    render(<MarkdownEditor value="" onChange={onChange} />);

    const editor = screen.getByRole("textbox");
    editor.innerHTML = "test<p>test</p><p>test</p>";
    fireEvent.input(editor);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(savedMarkdown).toBe("test\ntest\ntest\n");
    expect(savedMarkdown).not.toContain("testtest");
  });

  it("preserves br-based line breaks when saving", async () => {
    const onChange = vi.fn();

    render(<MarkdownEditor value="" onChange={onChange} />);

    const editor = screen.getByRole("textbox");
    editor.innerHTML = "line1<br>line2<br>line3";
    fireEvent.input(editor);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(savedMarkdown).toBe("line1\nline2\nline3");
  });

  it("keeps a heading on a new line after bare preceding text", async () => {
    const onChange = vi.fn();

    render(<MarkdownEditor value="" onChange={onChange} />);

    const editor = screen.getByRole("textbox");
    editor.innerHTML = "text<h2>heading</h2>";
    fireEvent.input(editor);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(savedMarkdown).toBe("text\n## heading\n");
    expect(savedMarkdown).not.toContain("text##");
  });

  it("keeps a blockquote on a new line after bare preceding text", async () => {
    const onChange = vi.fn();

    render(<MarkdownEditor value="" onChange={onChange} />);

    const editor = screen.getByRole("textbox");
    editor.innerHTML = "text<blockquote>quote</blockquote>";
    fireEvent.input(editor);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const savedMarkdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(savedMarkdown).toBe("text\n> quote\n");
    expect(savedMarkdown).not.toContain("textquote");
  });
});
