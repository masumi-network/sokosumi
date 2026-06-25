"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import FlowBackground from "@/app/hermes/components/flow-background";
import ProgressPips from "@/app/hermes/components/progress-pips";
import RotatingMessages from "@/app/hermes/components/rotating-messages";
import { AssistantOrb } from "@/components/aurora-orb";

import { getHermesOnboardingProgressAction } from "@/lib/actions/hermes";
import type {
  HermesOnboardingStep,
  HermesOnboardingProgress as ProgressShape,
} from "@/lib/hermes/types";
import { orderedMessageList } from "@/lib/intl/ordered-message-list";
import { cn } from "@/lib/utils";

interface OnboardingProgressProps {
  previewMode: boolean;
  /** Committed orb seed, or null for the white placeholder. */
  seed: string | null;
}

const POLL_INTERVAL_MS = 1_000;

/**
 * Production onboarding step order. Used for both the preview-mode mock and
 * the skeleton-state default before the first real poll lands. The UI keeps
 * these rows stable and merges orchestrator statuses onto them.
 */
const HERMES_ONBOARDING_STEP_IDS = [
  "save_details",
  "connect_integrations",
  "inbox_scan",
  "web_research",
  "sokosumi_sync",
  "intro_draft",
] as const;

const PREVIEW_STATUS_SEQUENCE: Array<Array<"pending" | "running" | "done">> = [
  ["running", "pending", "pending", "pending", "pending", "pending"],
  ["done", "running", "pending", "pending", "pending", "pending"],
  ["done", "done", "running", "pending", "pending", "pending"],
  ["done", "done", "done", "running", "pending", "pending"],
  ["done", "done", "done", "done", "running", "pending"],
  ["done", "done", "done", "done", "done", "running"],
];

function buildPreviewSequence(
  stepLabels: Record<string, string>,
): HermesOnboardingStep[][] {
  return PREVIEW_STATUS_SEQUENCE.map((statuses) =>
    HERMES_ONBOARDING_STEP_IDS.map((id, index) => ({
      id,
      label: stepLabels[id] ?? id,
      status: statuses[index]!,
    })),
  );
}

/**
 * Skeleton step list used before the first real poll resolves. First step
 * is "running" so the user sees a live spinner; the rest are pending. The
 * labels come from i18n previewSteps so the user reads real copy from the
 * first paint. When the orchestrator's statuses arrive, they update these
 * rows in place.
 */
function buildSkeletonSteps(
  stepLabels: Record<string, string>,
): HermesOnboardingStep[] {
  return HERMES_ONBOARDING_STEP_IDS.map((id, index) => ({
    id,
    label: stepLabels[id] ?? id,
    status: index === 0 ? "running" : "pending",
  }));
}

const PREVIEW_TICK_MS = 7_000;
const PREVIEW_TOTAL_SECONDS = 75;

/** After this many consecutive failed polls we surface a soft warning
 * instead of leaving the user staring at unchanging skeleton rows
 * indefinitely. Three because a single hiccup is noise; three in a row
 * is something the user deserves to know about. */
const POLL_ERROR_THRESHOLD = 3;

interface ProgressState {
  progress: ProgressShape;
  /** True once we've hit `POLL_ERROR_THRESHOLD` consecutive failures
   * without a successful poll. Resets on any successful poll. */
  pollError: boolean;
}

function useOnboardingProgress(
  previewMode: boolean,
  previewSequence: HermesOnboardingStep[][],
): ProgressState {
  const [state, setState] = useState<ProgressState>(() => ({
    progress: {
      status: "onboarding",
      steps: previewMode ? previewSequence[0]! : [],
      etaSeconds: previewMode ? PREVIEW_TOTAL_SECONDS : null,
    },
    pollError: false,
  }));

  useEffect(() => {
    if (previewMode) {
      // Mock-drive the steps for design iteration.
      let tick = 0;
      const id = setInterval(() => {
        tick = Math.min(tick + 1, previewSequence.length - 1);
        setState({
          progress: {
            status: "onboarding",
            steps: previewSequence[tick]!,
            etaSeconds: Math.max(
              0,
              PREVIEW_TOTAL_SECONDS - tick * (PREVIEW_TICK_MS / 1000),
            ),
          },
          pollError: false,
        });
      }, PREVIEW_TICK_MS);
      return () => clearInterval(id);
    }

    // Real-data path: poll the orchestrator-backed action every second.
    // The parent's instance polling will detect the status flip to `ready`
    // and unmount this component — no need to also branch off `status` here.
    let cancelled = false;
    let consecutiveFailures = 0;

    const tick = async () => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      const result = await getHermesOnboardingProgressAction({});
      if (cancelled) return;
      if (!result.ok) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= POLL_ERROR_THRESHOLD) {
          setState((prev) =>
            prev.pollError ? prev : { ...prev, pollError: true },
          );
        }
        return;
      }
      consecutiveFailures = 0;
      setState({
        progress: {
          status: result.data.status as ProgressShape["status"],
          steps: result.data.steps,
          etaSeconds: result.data.etaSeconds,
        },
        pollError: false,
      });
    };

    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [previewMode, previewSequence]);

  return state;
}

export default function OnboardingProgress({
  previewMode,
  seed,
}: OnboardingProgressProps) {
  const t = useTranslations("App.Hermes.OnboardingProgress");
  const previewSteps = useMemo(
    () => t.raw("previewSteps") as Record<string, string>,
    [t],
  );
  const previewSequence = useMemo(
    () => buildPreviewSequence(previewSteps),
    [previewSteps],
  );
  const skeletonSteps = useMemo(
    () => buildSkeletonSteps(previewSteps),
    [previewSteps],
  );
  const hints = useMemo(
    () => orderedMessageList(t.raw("hints") as Record<string, string>),
    [t],
  );
  const { progress, pollError } = useOnboardingProgress(
    previewMode,
    previewSequence,
  );
  const displaySteps =
    progress.steps.length > 0 ? progress.steps : skeletonSteps;

  return (
    <FlowBackground>
      <div className="mx-auto w-full max-w-2xl px-6 py-8 md:py-12">
        <ProgressPips current="personalizing" />

        {/* ── Hero ────────────────────────────────────────────────── */}
        <div className="mb-6 flex flex-col items-center text-center md:mb-8">
          <AssistantOrb
            seed={seed}
            size={160}
            expression="happy"
            className="size-20 md:size-24"
          />
          <h1 className="text-foreground mt-4 text-2xl font-light tracking-tight md:text-3xl">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
            {t("subtitle")}
          </p>
        </div>

        {/* ── Steps ───────────────────────────────────────────────── */}
        <ol className="border-border/60 bg-card/40 flex flex-col overflow-hidden rounded-xl border">
          {displaySteps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              isLast={index === displaySteps.length - 1}
            />
          ))}
        </ol>

        {/* Rotating hint instead of the misleading countdown. The orchestrator
          ETA is wildly variable (Composio MCP cold-start, OAuth verification,
          Gmail inbox size) so a per-second number reads as broken when it
          inevitably drifts. Honest copy + something fun to read. */}
        <div className="mt-4 flex min-h-8 items-center justify-center">
          <RotatingMessages
            messages={hints}
            intervalMs={5_500}
            className="text-muted-foreground max-w-md text-center text-xs leading-relaxed"
          />
        </div>

        {/* Surface persistent progress-poll failures rather than leaving the
            user staring at skeleton rows forever. Soft inline notice, not a
            full error state, because the orchestrator usually recovers on
            its own and the parent's instance polling still catches the
            terminal status flip. */}
        {pollError ? (
          <div className="border-amber-500/30 bg-amber-500/6 text-amber-700 dark:text-amber-400 mx-auto mt-3 flex max-w-md items-center gap-2 rounded-lg border px-3 py-2">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            <p className="text-xs leading-relaxed">{t("pollError")}</p>
          </div>
        ) : null}
      </div>
    </FlowBackground>
  );
}

function StepRow({
  step,
  isLast,
}: {
  step: HermesOnboardingStep;
  isLast: boolean;
}) {
  const isDone = step.status === "done";
  const isActive = step.status === "running";
  const isError = step.status === "error";
  const isSkipped = step.status === "skipped";

  return (
    <li
      className={cn(
        "flex flex-col gap-1 px-5 py-3 transition-colors",
        !isLast && "border-border/60 border-b",
        isActive && "bg-card",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full",
            isDone &&
              "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            isActive && "bg-primary/10 text-primary",
            isError && "bg-destructive/10 text-destructive",
            isSkipped && "bg-muted text-muted-foreground/70",
            !isDone &&
              !isActive &&
              !isError &&
              !isSkipped &&
              "bg-muted text-muted-foreground/60",
          )}
        >
          {isDone ? (
            <Check className="size-3.5" />
          ) : isActive ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : isError ? (
            <AlertCircle className="size-3.5" />
          ) : isSkipped ? (
            // Dash glyph reads as "not applicable" without needing copy.
            <span className="bg-muted-foreground/60 h-px w-2 rounded-full" />
          ) : (
            <span className="bg-muted-foreground/40 size-1.5 rounded-full" />
          )}
        </span>
        <span
          className={cn(
            "text-sm",
            isActive && "text-foreground font-medium",
            isDone && "text-foreground",
            isError && "text-destructive font-medium",
            isSkipped && "text-muted-foreground/70 line-through",
            !isDone &&
              !isActive &&
              !isError &&
              !isSkipped &&
              "text-muted-foreground",
          )}
        >
          {step.label}
        </span>
      </div>
      {isError && step.errorMessage && (
        <p className="text-destructive/80 ml-9 text-xs leading-relaxed">
          {step.errorMessage}
        </p>
      )}
    </li>
  );
}
