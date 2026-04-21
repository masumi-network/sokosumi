"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { getReasoningStepDisplayText } from "@/app/chat-ui/utils/reasoning-generic-labels";
import { cn } from "@/lib/utils";

interface ThoughtSummaryBarProps {
  reasoningMessages: Array<{ id: string; message: string }>;
  reasoningStartedAt: number | null;
  reasoningEndedAt: number | null;
}

export default function ThoughtSummaryBar({
  reasoningMessages,
  reasoningStartedAt,
  reasoningEndedAt,
}: ThoughtSummaryBarProps) {
  const t = useTranslations("App.Chat.Chat");
  const [isOpen, setIsOpen] = useState(false);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const isFrozen = reasoningStartedAt != null && reasoningEndedAt != null;
  const frozenSeconds = isFrozen
    ? Math.max(0, Math.floor((reasoningEndedAt - reasoningStartedAt) / 1000))
    : 0;
  const hasNoTiming = reasoningStartedAt == null && reasoningEndedAt == null;

  const subordinateSteps = reasoningMessages
    .map(({ message }) => getReasoningStepDisplayText(message))
    .filter((s): s is string => Boolean(s));

  useEffect(() => {
    if (reasoningStartedAt == null || isFrozen) return;
    const update = () =>
      setLiveSeconds(
        Math.max(0, Math.floor((Date.now() - reasoningStartedAt) / 1000)),
      );
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [reasoningStartedAt, isFrozen]);

  useEffect(() => {
    if (subordinateSteps.length === 0 || !isOpen) return;
    const el = viewportRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [subordinateSteps, isOpen]);

  const displaySeconds = isFrozen ? frozenSeconds : liveSeconds;
  /** Sub-second durations floor to 0; never show "0s" in copy. */
  const secondsForThoughtCopy = Math.max(1, displaySeconds);

  return (
    <div className="mb-1 flex flex-col">
      {subordinateSteps.length > 0 ? (
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="text-muted-foreground hover:text-foreground group flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm transition-colors"
          aria-expanded={isOpen}
          aria-label={
            isOpen ? t("reasoning.collapseSteps") : t("reasoning.expandSteps")
          }
        >
          <span>
            {hasNoTiming
              ? t("reasoning.expandSteps")
              : t("reasoning.thoughtForSeconds", {
                  seconds: secondsForThoughtCopy,
                })}
          </span>
          <span
            className={cn(
              "shrink-0 transition-opacity",
              isOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            aria-hidden
          >
            {isOpen ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </span>
        </button>
      ) : (
        <div className="text-muted-foreground flex w-full items-center px-4 py-1.5 text-sm">
          {hasNoTiming
            ? t("reasoning.expandSteps")
            : t("reasoning.thoughtForSeconds", {
                seconds: secondsForThoughtCopy,
              })}
        </div>
      )}
      {isOpen && subordinateSteps.length > 0 && (
        <div className="min-w-0 px-4 pt-0.5 pb-1.5">
          <div
            ref={viewportRef}
            className="reasoning-steps-viewport max-h-none overflow-x-hidden overflow-y-visible"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {subordinateSteps.map((step, index) => (
                <p
                  key={index}
                  className="reasoning-step-in text-muted-foreground text-sm leading-5 break-words whitespace-pre-wrap"
                >
                  {step}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
