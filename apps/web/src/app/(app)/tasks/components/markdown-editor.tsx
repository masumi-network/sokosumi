"use client";

import {
  Bold,
  Code,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatHeading,
  formatInlineCodeSnippet,
  formatMarkdownLink,
  getBacktickFence,
  normalizeUrl,
} from "@/lib/utils/markdown-editor-utils";

interface MarkdownEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  placeholder = "Enter details...",
  className,
}: MarkdownEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);

  // Convert markdown to HTML (only on initial load or external value changes)
  const markdownToHtml = useCallback((text: string): string => {
    if (!text) return "";

    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Extract fenced code blocks before other markdown transforms, so inline
    // patterns don't accidentally rewrite code content.
    const codeBlocks: Array<{
      token: string;
      html: string;
    }> = [];

    const withCodeBlockTokens = escaped.replace(
      /(^|\n)(`{3,})([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g,
      (
        _match,
        leadingNewline: string,
        fence: string,
        info: string,
        code: string,
      ) => {
        const token = `@@CODEBLOCK_${codeBlocks.length}@@`;
        const language = info.trim();
        const html = `<pre><code${
          language ? ` data-language="${language}"` : ""
        }>${code}</code></pre>`;

        codeBlocks.push({ token, html });
        return `${leadingNewline}${token}`;
      },
    );

    const html = withCodeBlockTokens
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/_(.+?)_/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[(.+?)\]\((.+?)\)/g, (_match, label: string, url: string) => {
        const normalizedUrl = normalizeUrl(url);
        if (!normalizedUrl) {
          return `[${label}](${url})`;
        }
        return `<a href="${normalizedUrl}">${label}</a>`;
      })
      .replace(/^[-*] (.+)$/gm, "<ul><li>$1</li></ul>")
      .replace(/^(\d+)\. (.+)$/gm, "<ol><li>$2</li></ol>")
      .replace(/\n/g, "<br>");

    return codeBlocks.reduce((result, block) => {
      return result.replace(block.token, block.html);
    }, html);
  }, []);

  // Convert HTML to markdown (on every change)
  const htmlToMarkdown = useCallback((element: HTMLElement): string => {
    let result = "";

    const processNode = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || "";
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();

        if (tag === "pre") {
          const content = el.textContent || "";
          const fence = getBacktickFence(content);
          return `${fence}\n${content}\n${fence}`;
        }

        let content = "";

        el.childNodes.forEach((child) => {
          content += processNode(child);
        });

        switch (tag) {
          case "strong":
          case "b":
            return `**${content}**`;
          case "em":
          case "i":
            return `_${content}_`;
          case "code":
            return `\`${content}\``;
          case "a":
            return `[${content}](${el.getAttribute("href") || ""})`;
          case "h1":
            return `# ${content}\n`;
          case "h2":
            return `## ${content}\n`;
          case "h3":
            return `### ${content}\n`;
          case "li":
            return `- ${content}\n`;
          case "ul": {
            const items = Array.from(el.children).filter(
              (child) => child.tagName.toLowerCase() === "li",
            );
            return items
              .map((child) => {
                let itemContent = "";
                child.childNodes.forEach((grandchild) => {
                  itemContent += processNode(grandchild);
                });
                return `- ${itemContent.trim()}`;
              })
              .join("\n")
              .concat("\n");
          }
          case "ol": {
            const items = Array.from(el.children).filter(
              (child) => child.tagName.toLowerCase() === "li",
            );
            return items
              .map((child, index) => {
                let itemContent = "";
                child.childNodes.forEach((grandchild) => {
                  itemContent += processNode(grandchild);
                });
                return `${index + 1}. ${itemContent.trim()}`;
              })
              .join("\n")
              .concat("\n");
          }
          case "br":
            return "\n";
          case "div":
          case "p":
            return content + "\n";
          default:
            return content;
        }
      }

      return "";
    };

    element.childNodes.forEach((node) => {
      result += processNode(node);
    });

    return result.trim();
  }, []);

  // Initialize editor content from value prop
  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      const currentHtml = editorRef.current.innerHTML;
      const newHtml = markdownToHtml(value);

      // Only update if content actually changed (avoid cursor jumping)
      if (
        currentHtml !== newHtml &&
        !editorRef.current.contains(document.activeElement)
      ) {
        editorRef.current.innerHTML = newHtml || "";
      }
    }
    isInternalChange.current = false;
  }, [value, markdownToHtml]);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      isInternalChange.current = true;
      const markdown = htmlToMarkdown(editorRef.current);
      onChange(markdown);
    }
  }, [htmlToMarkdown, onChange]);

  const execCommand = useCallback(
    (command: string, value?: string) => {
      editorRef.current?.focus();
      document.execCommand(command, false, value);
      handleInput();
    },
    [handleInput],
  );

  const insertText = useCallback(
    (text: string) => {
      editorRef.current?.focus();
      let didInsert = false;
      try {
        didInsert = document.execCommand("insertText", false, text);
      } catch (_error) {
        didInsert = false;
      }

      if (!didInsert) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } else if (editorRef.current) {
          editorRef.current.appendChild(document.createTextNode(text));
        }
      }

      handleInput();
    },
    [handleInput],
  );

  const handleBold = useCallback(() => execCommand("bold"), [execCommand]);
  const handleItalic = useCallback(() => execCommand("italic"), [execCommand]);
  const handleCode = () => {
    const text = window.getSelection()?.toString() ?? "";
    insertText(formatInlineCodeSnippet(text));
  };
  const handleLink = () => {
    const url = prompt("Enter URL:");
    if (url) {
      const text = window.getSelection()?.toString() ?? "";
      const link = formatMarkdownLink(text, url);
      if (link) {
        insertText(link);
      }
    }
  };
  const handleHeading = () => {
    const text = window.getSelection()?.toString() ?? "";
    insertText(formatHeading(text));
  };
  const handleBulletList = () => {
    execCommand("insertUnorderedList");
  };
  const handleNumberedList = () => {
    execCommand("insertOrderedList");
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // Cmd/Ctrl + B for bold
      if ((e.metaKey || e.ctrlKey) && key === "b") {
        e.preventDefault();
        handleBold();
        return;
      }

      // Cmd/Ctrl + I for italic
      if ((e.metaKey || e.ctrlKey) && key === "i") {
        e.preventDefault();
        handleItalic();
      }
    },
    [handleBold, handleItalic],
  );

  return (
    <div className={cn("rounded-md border", className)}>
      {/* Toolbar */}
      <div className="bg-muted/30 flex items-center gap-0.5 border-b px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleBold}
          title="Bold (Cmd+B)"
        >
          <Bold className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleItalic}
          title="Italic (Cmd+I)"
        >
          <Italic className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleCode}
          title="Code"
        >
          <Code className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleLink}
          title="Link"
        >
          <Link2 className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleHeading}
          title="Heading"
        >
          <Heading2 className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleBulletList}
          title="Bullet List"
        >
          <List className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleNumberedList}
          title="Numbered List"
        >
          <ListOrdered className="size-3.5" />
        </Button>
      </div>

      {/* Single editable area */}
      <div
        ref={editorRef}
        id={id}
        contentEditable
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        data-placeholder={placeholder}
        className={cn(
          "max-h-48 min-h-32 overflow-x-hidden overflow-y-auto px-3 py-2 text-sm",
          "outline-none focus:outline-none",
          "wrap-anywhere [word-break:break-word] whitespace-pre-wrap",
          "empty:before:text-muted-foreground empty:before:pointer-events-none empty:before:content-[attr(data-placeholder)]",
          "[&_em]:italic [&_strong]:font-bold",
          "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
          "[&_pre]:bg-muted [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-2 [&_pre]:whitespace-pre",
          "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs",
          "[&_a]:text-primary [&_a]:underline",
          "[&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-xl [&_h1]:font-bold",
          "[&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold",
          "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold",
          "[&_li]:ml-4 [&_ol>li]:list-decimal [&_ul>li]:list-disc",
        )}
      />
    </div>
  );
}
