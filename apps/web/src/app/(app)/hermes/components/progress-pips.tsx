"use client";

import { cn } from "@/lib/utils";

const STEPS = ["provisioning", "setup", "personalizing"] as const;
type Step = (typeof STEPS)[number];

const LABELS: Record<Step, string> = {
  provisioning: "Spinning up",
  setup: "Setup",
  personalizing: "Personalizing",
};

interface ProgressPipsProps {
  current: Step;
}

/**
 * Tiny three-dot pip indicator carried across provisioning → onboarding
 * screen → onboarding progress so the user has a stable "you are here"
 * anchor through the multi-screen flow.
 */
export default function ProgressPips({ current }: ProgressPipsProps) {
  const currentIdx = STEPS.indexOf(current);

  return (
    <div className="mb-12 flex items-center justify-center gap-2 md:mb-16">
      {STEPS.map((step, idx) => {
        const isCurrent = idx === currentIdx;
        const isDone = idx < currentIdx;
        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-1.5 text-xs transition-colors",
                isCurrent
                  ? "text-foreground font-medium"
                  : "text-muted-foreground/60",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full transition-colors",
                  isCurrent && "bg-primary",
                  isDone && "bg-foreground/40",
                  !isCurrent && !isDone && "bg-muted-foreground/30",
                )}
              />
              <span>{LABELS[step]}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <div aria-hidden className="bg-border h-px w-6" />
            )}
          </div>
        );
      })}
    </div>
  );
}
