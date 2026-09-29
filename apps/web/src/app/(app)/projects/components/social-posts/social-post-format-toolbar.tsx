"use client";

import { Bold, Italic, Link2, Underline } from "lucide-react";
import { useTranslations } from "next-intl";
import { type RefObject, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  type SocialPostTextStyle,
  toggleSocialPostTextStyle,
} from "./social-post-text-format";

interface SocialPostFormatToolbarProps {
  disabled?: boolean;
  onChange: (text: string) => void;
  text: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

const STYLES = [
  { style: "bold", Icon: Bold, key: "b" },
  { style: "italic", Icon: Italic, key: "i" },
  { style: "underline", Icon: Underline, key: "u" },
] as const satisfies readonly {
  style: SocialPostTextStyle;
  Icon: typeof Bold;
  key: string;
}[];

/** `https://` is assumed when the reader types a bare domain. */
function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const web = url.protocol === "http:" || url.protocol === "https:";
    return web && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Applies a style to the textarea's selection, keeping the selection on the
 * styled text so a second click turns it back off.
 */
export function applySocialPostTextStyle(
  textarea: HTMLTextAreaElement,
  text: string,
  style: SocialPostTextStyle,
): { text: string; start: number; end: number } | null {
  const { selectionStart: start, selectionEnd: end } = textarea;
  if (start === end) return null;
  const styled = toggleSocialPostTextStyle(text.slice(start, end), style);
  return {
    text: text.slice(0, start) + styled + text.slice(end),
    start,
    end: start + styled.length,
  };
}

/**
 * Bold, italic, underline and link for the post text. Networks take plain
 * text only, so styles become styled characters and a link is its URL, which
 * every network turns into a link. ⌘/Ctrl+B, I and U work in the textarea.
 */
export function SocialPostFormatToolbar({
  disabled,
  onChange,
  text,
  textareaRef,
}: SocialPostFormatToolbarProps) {
  const t = useTranslations("App.Projects.SocialPosts.composer.format");
  const urlId = useId();
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const normalizedUrl = normalizeUrl(url);

  function restoreSelection(start: number, end: number): void {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(start, end);
    });
  }

  function applyStyle(style: SocialPostTextStyle): void {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const next = applySocialPostTextStyle(textarea, text, style);
    if (!next) {
      textarea.focus();
      return;
    }
    onChange(next.text);
    restoreSelection(next.start, next.end);
  }

  function insertLink(): void {
    if (!normalizedUrl) return;
    const textarea = textareaRef.current;
    const end = textarea?.selectionEnd ?? text.length;
    const before = text.slice(0, end);
    const after = text.slice(end);
    // The URL stands on its own, so the network sees it as a link.
    const lead = before && !/\s$/.test(before) ? " " : "";
    const trail = after && !/^\s/.test(after) ? " " : "";
    const inserted = `${lead}${normalizedUrl}${trail}`;
    onChange(before + inserted + after);
    setUrl("");
    setLinkOpen(false);
    const caret = end + inserted.length;
    restoreSelection(caret, caret);
  }

  return (
    <div
      aria-label={t("label")}
      className="flex items-center gap-0.5"
      data-testid="social-post-format-toolbar"
      role="toolbar"
    >
      {STYLES.map(({ style, Icon }) => (
        <Tooltip key={style}>
          <TooltipTrigger asChild>
            <Button
              aria-label={t(style)}
              disabled={disabled}
              // Keep the textarea's selection: a click would move focus first.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyStyle(style)}
              size="icon"
              type="button"
              variant="ghost"
              className="size-8"
            >
              <Icon className="size-4" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t(`${style}Hint`)}</TooltipContent>
        </Tooltip>
      ))}
      <Popover open={linkOpen} onOpenChange={setLinkOpen}>
        <PopoverTrigger asChild>
          <Button
            aria-label={t("link")}
            className="size-8"
            disabled={disabled}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Link2 className="size-4" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-2 p-3">
          <label className="text-sm font-medium" htmlFor={urlId}>
            {t("linkUrl")}
          </label>
          <div className="flex gap-2">
            <Input
              autoFocus
              id={urlId}
              inputMode="url"
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  insertLink();
                }
              }}
              placeholder="https://"
              value={url}
            />
            <Button
              disabled={!normalizedUrl}
              onClick={insertLink}
              size="sm"
              type="button"
            >
              {t("linkAdd")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** ⌘/Ctrl+B, I or U on the textarea: the style to apply, or null. */
export function socialPostShortcutStyle(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >,
): SocialPostTextStyle | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return null;
  }
  return (
    STYLES.find(({ key }) => key === event.key.toLowerCase())?.style ?? null
  );
}
