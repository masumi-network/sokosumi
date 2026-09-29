"use client";

import { CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { useMemo, useRef } from "react";
import { toast } from "sonner";
import type { ComposerChannelOption } from "@/components/chat/composer-suggestions";
import {
  ComposerWysiwygEditor,
  type ComposerWysiwygEditorHandle,
} from "@/components/chat/composer-wysiwyg-editor";
import { Button } from "@/components/ui/button";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea-utils";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomSokoBotParticipant,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import {
  composerMentionDisplayNames,
  isRoomComposerContentCountVisible,
  isRoomComposerContentOverLimit,
  type RoomMentionParticipant,
  type UserMentionLookup,
} from "./room-helpers";

export function MessageEditComposer({
  value,
  originalContent,
  onChange,
  onSave,
  onCancel,
  isSaving,
  mentions = {},
  usersById,
  usersBySlug,
  coworkersById,
  coworkersBySlug,
  sokoBotsById,
  sokoBotsBySlug,
  channels = [],
}: {
  value: string;
  originalContent: string;
  onChange: (value: string) => void;
  onSave: (content: string) => void;
  onCancel: () => void;
  isSaving: boolean;
  mentions?: Record<string, MentionRecordEntry<RoomMentionParticipant>>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
  coworkersById?: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug?: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
  channels?: readonly ComposerChannelOption[];
}) {
  const t = useTranslations("App.Channels");
  const editorRef = useRef<ComposerWysiwygEditorHandle>(null);
  const liveRef = useRef(value);
  liveRef.current = value;

  const mentionDisplay = useMemo(
    () =>
      composerMentionDisplayNames({
        usersById,
        usersBySlug,
        coworkersById,
        coworkersBySlug,
        sokoBotsById,
        sokoBotsBySlug,
        mentionCatalog: mentions,
      }),
    [
      coworkersById,
      coworkersBySlug,
      mentions,
      sokoBotsById,
      sokoBotsBySlug,
      usersById,
      usersBySlug,
    ],
  );

  useMountEffect(() => {
    editorRef.current?.focusAtEnd();
  });

  function liveMarkdown(): string {
    return editorRef.current?.getMarkdown() ?? liveRef.current;
  }

  function handleCommit() {
    if (isSaving) return;
    const markdown = liveMarkdown();
    const liveTrimmed = markdown.trim();
    const originalTrimmed = originalContent.trim();
    if (isRoomComposerContentOverLimit(liveTrimmed)) {
      toast.error(
        t("composerTooLong", {
          count: liveTrimmed.length,
          max: CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
        }),
      );
      return;
    }
    if (liveTrimmed.length > 0 && liveTrimmed !== originalTrimmed) {
      onSave(markdown);
      return;
    }
    onCancel();
  }

  const trimmedEditContent = value.trim();
  const editOverLimit = isRoomComposerContentOverLimit(trimmedEditContent);
  const showEditContentCount =
    isRoomComposerContentCountVisible(trimmedEditContent);
  const canSaveEdit =
    !isSaving &&
    !editOverLimit &&
    trimmedEditContent.length > 0 &&
    trimmedEditContent !== originalContent.trim();

  return (
    <div className="pt-0.5">
      <div
        className={cn(
          "border-input focus-within:border-ring focus-within:ring-ring-halo dark:bg-quinary rounded-md border bg-transparent focus-within:ring-[3px]",
          isSaving && "pointer-events-none opacity-50",
        )}
      >
        <ComposerWysiwygEditor
          ref={editorRef}
          value={value}
          onChange={(next) => {
            liveRef.current = next;
            onChange(next);
          }}
          mentions={mentions}
          mentionDisplayByKey={mentionDisplay.byKey}
          mentionDisplayBySlug={mentionDisplay.bySlug}
          channels={channels}
          disabled={isSaving}
          ariaLabel={t("Edit.composerAria")}
          onSubmitShortcut={handleCommit}
          onEscape={() => {
            if (!isSaving) onCancel();
          }}
          onBlur={() => {
            if (isSaving) return;
            if (liveMarkdown().trim() === originalContent.trim()) {
              onCancel();
            }
          }}
          className="app-scrollbar min-h-10 max-h-40 overflow-y-auto px-3 py-2.5 leading-6"
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isSaving}
          onClick={onCancel}
        >
          {t("Edit.cancel")}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!canSaveEdit}
          onClick={handleCommit}
        >
          {t("Edit.save")}
        </Button>
      </div>
      {editOverLimit || showEditContentCount ? (
        <div className="flex items-start justify-between gap-2 pt-1">
          {editOverLimit ? (
            <p className="text-destructive text-xs" role="alert">
              {t("composerTooLongHint")}
            </p>
          ) : (
            <span />
          )}
          {showEditContentCount ? (
            <span
              className={cn(
                "text-xs tabular-nums",
                editOverLimit ? "text-destructive" : "text-muted-foreground",
              )}
              aria-live="polite"
            >
              {t("composerCharacterCount", {
                count: trimmedEditContent.length,
                max: CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
              })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
