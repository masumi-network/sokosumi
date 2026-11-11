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
import { SEO_CHAT_QUESTION_LIMIT } from "./use-seo-chat";

const SEO_AGENT_PROMPTS = ["first", "queries", "track", "competitors"] as const;

/** The example questions the saved data can answer: no search statistics, no question about searches. */
export function seoAgentPrompts({
  competitors,
  searches,
}: {
  /** False where the Audit has no competitor. */
  competitors: boolean;
  /** False where no search statistics are synced: the question about keywords to track stands in. */
  searches: boolean;
}) {
  return SEO_AGENT_PROMPTS.filter(
    (prompt) =>
      (competitors || prompt !== "competitors") &&
      prompt !== (searches ? "track" : "queries"),
  );
}

/** An IME reports this key code for the Enter that confirms a composition. */
const IME_KEY_CODE = 229;

/** Questions the reader can send with one click. */
export function SeoPromptChips({
  busy = false,
  competitors = true,
  searches = true,
  onPick,
}: {
  busy?: boolean;
  /** False where the Audit has no competitor: the question about them has no answer. */
  competitors?: boolean;
  /** False where no search statistics are synced. */
  searches?: boolean;
  onPick: (question: string) => void;
}) {
  const t = useTranslations("App.Seo");
  return (
    <div className="flex flex-wrap gap-2">
      {seoAgentPrompts({ competitors, searches }).map((prompt) => (
        <button
          key={prompt}
          type="button"
          // The app's prompt chip: a quiet pill that wraps inside the panel on a phone.
          className="border-border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring press inline-flex min-h-8 max-w-full items-center rounded-full border px-3 py-1 text-start text-sm transition-colors outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 max-sm:min-h-10"
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
