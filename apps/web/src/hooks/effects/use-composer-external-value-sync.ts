"use client";

import { type RefObject, useEffect } from "react";
import type { ComposerChannelOption } from "@/components/chat/composer-suggestions";
import { markdownToHtml } from "@/lib/utils/composer-markdown-dom";

function isComposerEditorDomEmpty(editor: HTMLElement): boolean {
  const html = editor.innerHTML;
  return (
    html === "" ||
    html === "<br>" ||
    html === "<div><br></div>" ||
    html === "<p><br></p>" ||
    (editor.textContent ?? "").replace(/\u200b/g, "").trim() === ""
  );
}

interface ComposerExternalValueSyncParams {
  editorRef: RefObject<HTMLDivElement | null>;
  isInternalChange: RefObject<boolean>;
  value: string;
  channels: readonly ComposerChannelOption[];
  resolveMentionDisplay: Parameters<typeof markdownToHtml>[1];
}

/**
 * Syncs external markdown `value` changes into the `ComposerWysiwygEditor`
 * contentEditable DOM while preserving caret position during internal edits
 * and always applying external clears.
 */
export function useComposerExternalValueSync({
  editorRef,
  isInternalChange,
  value,
  channels,
  resolveMentionDisplay,
}: ComposerExternalValueSyncParams): void {
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      isInternalChange.current = false;
      return;
    }

    const isExternalClear = value.trim().length === 0;
    // Clears must win over isInternalChange: a same-turn clear after input
    // otherwise leaves stale DOM because this effect will not re-run for "".
    if (isInternalChange.current && !isExternalClear) {
      isInternalChange.current = false;
      return;
    }

    const currentHtml = editor.innerHTML;
    const newHtml = markdownToHtml(value, resolveMentionDisplay, {
      channelLinks: channels.map((channel) => ({
        name: channel.name,
        slug: channel.slug,
      })),
      wrapUnknownMentions: false,
    });
    const isFocused = editor.contains(document.activeElement);
    const editorLooksEmpty = isComposerEditorDomEmpty(editor);

    // Focused non-clear updates skip to keep the caret; still apply into an
    // empty editor (restore after failed send cleared DOM first).
    if (
      currentHtml !== newHtml &&
      (!isFocused || isExternalClear || editorLooksEmpty)
    ) {
      editor.innerHTML = newHtml || "";
    }
    isInternalChange.current = false;
  }, [channels, resolveMentionDisplay, value]);
}
