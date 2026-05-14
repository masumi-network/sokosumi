"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const STEP_KEYS = ["step1", "step2", "step3", "step4"] as const;
const STEP_INTERVAL_MS = 6_000;

/**
 * Indeterminate provisioning view, ASCII/terminal style. Steps illustrate
 * the orchestrator's bootstrap stages and step forward at a steady cadence;
 * the parent component decides when to navigate away based on the actual
 * instance status. The last step holds with a spinner if provisioning takes
 * longer than expected (~30s happy path, occasionally up to a couple of
 * minutes).
 */
export default function ProvisioningState() {
  const t = useTranslations("App.Hermes.Provisioning");
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < STEP_KEYS.length; i++) {
      timers.push(
        setTimeout(
          () => setStepIndex(Math.min(i + 1, STEP_KEYS.length - 1)),
          STEP_INTERVAL_MS * (i + 1),
        ),
      );
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="text-foreground mx-auto w-full max-w-4xl px-4 py-12 font-mono md:py-16">
      <div className="text-tertiary-foreground mb-6 flex items-center justify-between text-[11px] tracking-wide">
        <span>┌─[ /hermes ]</span>
        <span className="border-border/60 rounded-sm border px-1.5 py-0 text-[10px] uppercase tracking-widest">
          provisioning
        </span>
      </div>

      <div className="border-border/60 bg-muted/10 rounded-md border p-5 md:p-6">
        <div className="text-foreground flex items-baseline gap-1.5 text-base md:text-lg">
          <span className="text-tertiary-foreground">{">"}</span>
          <span>{t("title").toLowerCase()}</span>
          <span
            aria-hidden
            className="bg-foreground inline-block h-[0.85em] w-[0.5em] animate-pulse"
          />
        </div>
        <p className="text-muted-foreground mt-2 ml-5 text-xs leading-relaxed">
          {t("subtitle").toLowerCase()}
        </p>
      </div>

      <ol className="mt-6 flex flex-col gap-1 text-sm">
        {STEP_KEYS.map((key, idx) => {
          const isDone = idx < stepIndex;
          const isActive = idx === stepIndex;
          const isPending = idx > stepIndex;

          const marker = isDone ? "[✓]" : isActive ? "[…]" : "[ ]";

          return (
            <li
              key={key}
              className={cn(
                "flex items-baseline gap-3 px-2 py-1.5 transition-colors",
                isActive && "bg-muted/40 rounded-sm",
              )}
            >
              <span
                className={cn(
                  "tabular-nums",
                  isDone && "text-foreground",
                  isActive && "text-foreground animate-pulse",
                  isPending && "text-tertiary-foreground/60",
                )}
              >
                {marker}
              </span>
              <span
                className={cn(
                  isPending ? "text-tertiary-foreground" : "text-foreground",
                  isActive && "font-medium",
                )}
              >
                {t(key).toLowerCase()}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="text-tertiary-foreground mt-10 flex items-center justify-between border-t pt-4 text-[11px] tracking-wide">
        <span>└─[ ~30s typical ]</span>
        <span>v0.1 · beta</span>
      </div>
    </div>
  );
}
