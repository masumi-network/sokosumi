"use client";

import { Lock, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  ROOM_COMPOSER_TEXTAREA_CLASSNAME,
  RoomMessageComposer,
} from "@/components/chat/room-message-composer";
import { Textarea } from "@/components/ui/textarea";
import { resolveComposerEnterAction } from "@/lib/utils/composer-wysiwyg-input-rules";
import { devicePrefersHover } from "@/lib/utils/device-prefers-hover";
import type { SeoChatPrompt } from "./seo-chat-prompts";
import { SEO_CHAT_QUESTION_LIMIT } from "./use-seo-chat";

/** An IME reports this key code for the Enter that confirms a composition. */
const IME_KEY_CODE = 229;

/** Questions the reader can send with one click: small chips right over the question field. */
export function SeoPromptChips({
  busy = false,
  prompts,
  onPick,
}: {
  busy?: boolean;
  prompts: readonly SeoChatPrompt[];
  onPick: (question: string) => void;
}) {
  const t = useTranslations("App.Seo");
  if (!prompts.length) return null;
  return (
    // A new set rises in, so the change after an answer is seen.
    <div key={prompts.join()} className="content-rise flex flex-wrap gap-2">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          // A quiet pill. On a phone an invisible band widens the hit area to 40px.
          className="border-border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring press relative inline-flex min-h-7 max-w-full items-center rounded-full border px-2.5 py-0.5 text-start text-xs transition-colors outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 max-sm:min-h-8 max-sm:before:absolute max-sm:before:inset-x-0 max-sm:before:-inset-y-1 max-sm:before:content-['']"
          // Not the disabled attribute: that drops focus from the chip just pressed.
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onPick(t(`agent.prompts.${prompt}`));
          }}
        >
          {t(`agent.prompts.${prompt}`)}
        </button>
      ))}
    </div>
  );
}

/** The question field with Send and the line that says who can read the chat. */
export function SeoChatComposer({
  inputId,
  value,
  onChange,
  onSend,
  busy = false,
  sharing,
}: {
  inputId: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  busy?: boolean;
  sharing: "organization" | "personal";
}) {
  const t = useTranslations("App.Seo");
  const Sharing = sharing === "organization" ? Users : Lock;
  return (
    <>
      <RoomMessageComposer
        withOuterPadding={false}
        withSafeAreaPadding={false}
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
        attachments={[]}
        onRemoveAttachment={() => {}}
        removeAttachmentLabel={(name) => name}
        isSending={busy}
        sendDisabled={!value.trim()}
        sendAriaLabel={t("chat.send")}
        // Send keeps the app composer's filled style in every chat, next to
        // this page's own primary button.
        toolbarStart={
          // Who can read the chat sits next to Send, where it matters.
          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            <Sharing className="size-3.5 shrink-0" />
            <span className="min-w-0">
              {t(
                sharing === "organization"
                  ? "chat.sharedShort"
                  : "chat.privateShort",
              )}
            </span>
          </span>
        }
      >
        <Textarea
          id={inputId}
          aria-label={t("chat.question")}
          aria-describedby={`${inputId}-sharing`}
          placeholder={t("chat.placeholder")}
          className={ROOM_COMPOSER_TEXTAREA_CLASSNAME}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.altKey ||
              event.nativeEvent.isComposing ||
              // Safari ends the composition before this event.
              event.keyCode === IME_KEY_CODE
            )
              return;
            // The app's composer rule: Enter sends, a modifier or a touch
            // keyboard starts a new line.
            const action = resolveComposerEnterAction({
              shiftKey: event.shiftKey,
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey,
              isSuggestionKeyboardActive: false,
              isTouchDevice: !devicePrefersHover(),
            });
            if (action === "submit") {
              event.preventDefault();
              onSend();
            } else if (event.metaKey || event.ctrlKey) {
              // A text field starts no line on Ctrl or Cmd+Enter by itself.
              event.preventDefault();
              const field = event.currentTarget;
              const { selectionStart, selectionEnd, value: text } = field;
              // The field's own limit does not cover an edit made here.
              if (
                text.length - (selectionEnd - selectionStart) >=
                SEO_CHAT_QUESTION_LIMIT
              )
                return;
              field.setRangeText("\n", selectionStart, selectionEnd, "end");
              // React keeps its own record of the field's value. The input
              // event brings that record in step, so the next edit counts.
              field.dispatchEvent(new Event("input", { bubbles: true }));
              onChange(field.value);
            }
          }}
          maxLength={SEO_CHAT_QUESTION_LIMIT}
          rows={1}
          required
        />
      </RoomMessageComposer>
      {/* Hidden text still describes the field, and is not read a second time. */}
      <p id={`${inputId}-sharing`} hidden>
        {t(sharing === "organization" ? "chat.shared" : "chat.private")}
      </p>
    </>
  );
}
