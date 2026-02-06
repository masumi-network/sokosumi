"use client";

import { Bold, Code, Heading2, Italic, Link2, List, ListOrdered } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
      .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
      .replace(/\n/g, '<br>');
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
        let content = "";

        el.childNodes.forEach(child => {
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
          case "ul":
          case "ol":
            return content;
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

    element.childNodes.forEach(node => {
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
      if (currentHtml !== newHtml && !editorRef.current.contains(document.activeElement)) {
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

  const execCommand = useCallback((command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    handleInput();
  }, [handleInput]);

  const insertHtml = useCallback((html: string) => {
    editorRef.current?.focus();
    document.execCommand("insertHTML", false, html);
    handleInput();
  }, [handleInput]);

  const handleBold = () => execCommand("bold");
  const handleItalic = () => execCommand("italic");
  const handleCode = () => {
    const selection = window.getSelection();
    const text = selection?.toString() || "code";
    insertHtml(`<code>${text}</code>`);
  };
  const handleLink = () => {
    const url = prompt("Enter URL:");
    if (url) {
      const selection = window.getSelection();
      const text = selection?.toString() || "link";
      insertHtml(`<a href="${url}">${text}</a>`);
    }
  };
  const handleHeading = () => {
    const selection = window.getSelection();
    const text = selection?.toString() || "Heading";
    insertHtml(`<h2>${text}</h2>`);
  };
  const handleBulletList = () => {
    const selection = window.getSelection();
    const text = selection?.toString() || "List item";
    insertHtml(`<li>${text}</li>`);
  };
  const handleNumberedList = () => {
    const selection = window.getSelection();
    const text = selection?.toString() || "List item";
    insertHtml(`<li>${text}</li>`);
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Cmd/Ctrl + B for bold
    if ((e.metaKey || e.ctrlKey) && e.key === "b") {
      e.preventDefault();
      handleBold();
    }
    // Cmd/Ctrl + I for italic
    if ((e.metaKey || e.ctrlKey) && e.key === "i") {
      e.preventDefault();
      handleItalic();
    }
  }, []);

  return (
    <div className={cn("rounded-md border", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b px-2 py-1.5 bg-muted/30">
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleBold} title="Bold (Cmd+B)">
          <Bold className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleItalic} title="Italic (Cmd+I)">
          <Italic className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCode} title="Code">
          <Code className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleLink} title="Link">
          <Link2 className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleHeading} title="Heading">
          <Heading2 className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleBulletList} title="Bullet List">
          <List className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleNumberedList} title="Numbered List">
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
          "px-3 py-2 text-sm min-h-32 max-h-48 overflow-y-auto overflow-x-hidden",
          "outline-none focus:outline-none",
          "break-words whitespace-pre-wrap [overflow-wrap:anywhere] [word-break:break-word]",
          "[&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-muted-foreground [&:empty]:before:pointer-events-none",
          "[&_strong]:font-bold [&_em]:italic",
          "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono",
          "[&_a]:text-primary [&_a]:underline",
          "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1",
          "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1",
          "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1",
          "[&_li]:ml-4 [&_li]:list-disc",
        )}
      />
    </div>
  );
}
