"use client";

import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
  Underline,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComposerFormatCommand } from "@/lib/utils/composer-markdown-wrap";

interface ComposerFormatToolbarProps {
  onFormat: (command: ComposerFormatCommand) => void;
  onLink: () => void;
  className?: string;
}

interface FormatTool {
  key: string;
  labelKey:
    | "bold"
    | "italic"
    | "underline"
    | "strikethrough"
    | "code"
    | "codeBlock"
    | "quote"
    | "bulletList"
    | "numberedList"
    | "link";
  icon: ReactNode;
  onClick: () => void;
}

/**
 * Slack-style formatting strip. Order matches Slack compose: marks, link,
 * lists, quote, then code.
 */
export function ComposerFormatToolbar({
  onFormat,
  onLink,
  className,
}: ComposerFormatToolbarProps) {
  const t = useTranslations("App.Channels.Toolbar");

  const tools: FormatTool[] = [
    {
      key: "bold",
      labelKey: "bold",
      icon: <Bold className="size-4" aria-hidden />,
      onClick: () => onFormat("bold"),
    },
    {
      key: "italic",
      labelKey: "italic",
      icon: <Italic className="size-4" aria-hidden />,
      onClick: () => onFormat("italic"),
    },
    {
      key: "underline",
      labelKey: "underline",
      icon: <Underline className="size-4" aria-hidden />,
      onClick: () => onFormat("underline"),
    },
    {
      key: "strikethrough",
      labelKey: "strikethrough",
      icon: <Strikethrough className="size-4" aria-hidden />,
      onClick: () => onFormat("strikethrough"),
    },
    {
      key: "link",
      labelKey: "link",
      icon: <Link2 className="size-4" aria-hidden />,
      onClick: onLink,
    },
    {
      key: "numberedList",
      labelKey: "numberedList",
      icon: <ListOrdered className="size-4" aria-hidden />,
      onClick: () => onFormat("numberedList"),
    },
    {
      key: "bulletList",
      labelKey: "bulletList",
      icon: <List className="size-4" aria-hidden />,
      onClick: () => onFormat("bulletList"),
    },
    {
      key: "quote",
      labelKey: "quote",
      icon: <Quote className="size-4" aria-hidden />,
      onClick: () => onFormat("quote"),
    },
    {
      key: "code",
      labelKey: "code",
      icon: <Code className="size-4" aria-hidden />,
      onClick: () => onFormat("code"),
    },
    {
      key: "codeBlock",
      labelKey: "codeBlock",
      icon: <SquareCode className="size-4" aria-hidden />,
      onClick: () => onFormat("codeBlock"),
    },
  ];

  return (
    <div
      role="toolbar"
      aria-label={t("format")}
      className={cn(
        "border-border bg-muted/20 flex max-w-full items-center gap-0.5 overflow-x-auto border-b px-2 py-1.5",
        className,
      )}
    >
      {tools.map((tool) => (
        <Button
          key={tool.key}
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-8 shrink-0 rounded-md"
          title={t(tool.labelKey)}
          aria-label={t(tool.labelKey)}
          onClick={tool.onClick}
        >
          {tool.icon}
        </Button>
      ))}
    </div>
  );
}
