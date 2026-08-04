import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "@/app/tasks/components/markdown-editor";

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
