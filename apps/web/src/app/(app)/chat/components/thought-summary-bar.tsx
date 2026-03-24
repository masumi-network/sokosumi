"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { isReasoningGenericLabel } from "@/app/chat/utils/reasoning-generic-labels";
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

  const subordinateSteps = reasoningMessages
    .filter(({ message }) => !isReasoningGenericLabel(message))
    .map(({ message }) => message.trim())
    .filter(Boolean);

  const hasReasoningSteps = subordinateSteps.length > 0;

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
    if (!hasReasoningSteps || !isOpen) return;
    const el = viewportRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [hasReasoningSteps, isOpen, subordinateSteps]);

  const displaySeconds = isFrozen ? frozenSeconds : liveSeconds;
  const isRecordedView = reasoningEndedAt != null;

  return (
    <div className="mb-1 flex flex-col">
      {hasReasoningSteps ? (
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
            {t("reasoning.thoughtForSeconds", { seconds: displaySeconds })}
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
          {t("reasoning.thoughtForSeconds", { seconds: displaySeconds })}
        </div>
      )}
      {isOpen && hasReasoningSteps && (
        <div className="min-w-0 px-4 pt-0.5 pb-1.5">
          <div
            ref={viewportRef}
            className={cn(
              "reasoning-steps-viewport overflow-x-hidden",
              isRecordedView
                ? "overflow-y-visible"
                : "max-h-[3.75rem] overflow-y-auto",
            )}
            style={{ scrollBehavior: "smooth" }}
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
