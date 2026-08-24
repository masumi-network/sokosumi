"use client";

import { ArrowDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FormEvent, RefObject } from "react";
import { useEffect, useState } from "react";

import { ArrowUpIcon, StopIcon } from "@/components/chat/icons";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/chat/prompt-input";
import { Button } from "@/components/ui/button";
import { orderedMessageList } from "@/lib/intl/ordered-message-list";
import { cn } from "@/lib/utils";

const ROTATE_INTERVAL_MS = 4_500;
export const MAX_MESSAGE_LENGTH = 8_000;

interface ComposerProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  setInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
  isReplying: boolean;
  isStopping: boolean;
  isSending: boolean;
  paused: boolean;
  botName: string;
  atBottom: boolean;
  isEmpty: boolean;
  onScrollToBottom: () => void;
}

/**
 * The chat composer: same animated gradient border and glow as `/chat`
 * (`.chat-input-border-anchor`) so the two surfaces read as one product.
 * While a turn runs the send control becomes Stop; typing stays possible.
 */
export function Composer({
  textareaRef,
  input,
  setInput,
  onSubmit,
  onStop,
  isReplying,
  isStopping,
  isSending,
  paused,
  botName,
  atBottom,
  isEmpty,
  onScrollToBottom,
}: ComposerProps) {
  const t = useTranslations("App.SokoBot.Chat.composer");
  const hints = orderedMessageList(t.raw("hints") as Record<string, string>);
  const canSend =
    input.trim().length > 0 && !isReplying && !isSending && !paused;

  const [hintIndex, setHintIndex] = useState(0);
  useEffect(() => {
    if (input.length > 0 || isReplying || hints.length === 0) return;
    const id = window.setInterval(
      () => setHintIndex((i) => (i + 1) % hints.length),
      ROTATE_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [input.length, isReplying, hints.length]);

  const placeholder = paused
    ? t("pausedPlaceholder")
    : isReplying
      ? t("workingPlaceholder")
      : input.length > 0
        ? t("placeholder", { bot: botName })
        : (hints[hintIndex] ?? t("placeholder", { bot: botName }));

  return (
    <div className="bg-background relative mx-auto flex w-full shrink-0 flex-col items-center px-4 pt-2 pb-4">
      <div
        aria-hidden
        className="from-background pointer-events-none absolute -top-8 right-0 left-0 z-5 h-8 bg-linear-to-t to-transparent"
      />
      {!atBottom && !isEmpty ? (
        <button
          type="button"
          onClick={onScrollToBottom}
          className="bg-background text-foreground border-border hover:bg-muted/60 hover:border-foreground/30 focus-visible:ring-primary/40 absolute -top-11 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2"
        >
          <ArrowDown aria-hidden className="size-3.5" />
          {t("jumpToLatest")}
        </button>
      ) : null}
      <div className="w-full max-w-3xl">
        <div
          className={cn(
            "chat-input-border-anchor relative z-10 rounded-xl",
            "shadow-[0_0_16px_0] shadow-primary/15",
            "focus-within:shadow-[0_0_24px_2px] focus-within:shadow-primary/30",
            "transition-shadow duration-300",
            paused && "pointer-events-none opacity-60",
          )}
        >
          <PromptInput
            onSubmit={onSubmit}
            className="bg-background relative z-10 rounded-[calc(var(--radius-xl)-1.5px)] border-0 shadow-none"
          >
            <PromptInputTextarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={placeholder}
              disableAutoResize
              maxHeight={200}
              minHeight={44}
              maxLength={MAX_MESSAGE_LENGTH}
              autoFocus
              disabled={paused}
              aria-label={t("label")}
              className="placeholder:text-muted-foreground scrollbar-none grow resize-none border-0! bg-transparent p-4 ring-0 outline-none [-ms-overflow-style:none] focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none [&::-webkit-scrollbar]:hidden"
            />
            <PromptInputToolbar className="border-t-0 p-3">
              <PromptInputTools>
                <span className="text-muted-foreground hidden text-xs sm:inline">
                  {isReplying ? t("workingHint") : t("hint")}
                </span>
              </PromptInputTools>
              {isReplying ? (
                <Button
                  type="button"
                  variant="default"
                  size="icon"
                  onClick={onStop}
                  disabled={isStopping}
                  aria-label={t("stop")}
                  className="size-8 rounded-full"
                >
                  <StopIcon size={14} />
                </Button>
              ) : (
                <PromptInputSubmit
                  className="size-8 rounded-full transition-colors duration-200"
                  disabled={!canSend}
                  status={isSending ? "submitted" : "ready"}
                  aria-label={t("send")}
                >
                  <ArrowUpIcon size={14} />
                </PromptInputSubmit>
              )}
            </PromptInputToolbar>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
