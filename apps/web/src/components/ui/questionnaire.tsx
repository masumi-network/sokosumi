"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface QuestionnaireProps {
  stepCount: number;
  stepIndex: number;
  children: ReactNode;
  onNext: () => void;
  onBack: () => void;
  nextLabel?: string;
  backLabel?: string;
  skipLabel?: string;
  onSkip?: () => void;
  nextDisabled?: boolean;
  className?: string;
}

/**
 * Generic multi-step questionnaire shell (single / freeform / skip via children).
 * Domain-agnostic — onboarding owns step content.
 */
export function Questionnaire({
  stepCount,
  stepIndex,
  children,
  onNext,
  onBack,
  nextLabel = "Next",
  backLabel = "Back",
  skipLabel = "Skip",
  onSkip,
  nextDisabled = false,
  className,
}: QuestionnaireProps): React.ReactElement {
  const canGoBack = stepIndex > 0;
  const progress =
    stepCount > 0 ? Math.min(1, (stepIndex + 1) / stepCount) : 0;

  return (
    <div
      data-slot="questionnaire"
      className={cn("flex min-h-0 flex-1 flex-col gap-6", className)}
    >
      <div
        className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={stepCount}
        aria-valuenow={stepIndex + 1}
      >
        <div
          className="bg-primary h-full transition-[width] duration-200"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {children}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {canGoBack ? (
            <Button type="button" variant="ghost" onClick={onBack}>
              {backLabel}
            </Button>
          ) : (
            <span />
          )}
          {onSkip ? (
            <Button type="button" variant="ghost" onClick={onSkip}>
              {skipLabel}
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={onNext}
          disabled={nextDisabled}
        >
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
