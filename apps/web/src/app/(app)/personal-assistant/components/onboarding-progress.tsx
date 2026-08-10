"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import FlowBackground from "@/app/personal-assistant/components/flow-background";
import ProgressPips from "@/app/personal-assistant/components/progress-pips";
import RotatingMessages from "@/app/personal-assistant/components/rotating-messages";
import {
  formatElapsed,
  useElapsedSeconds,
} from "@/app/personal-assistant/components/use-elapsed-seconds";
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
  /** Wall-clock ms when onboarding started, persisted across a tab
   * close/reopen — same anchor pattern as the provisioning screen. */
  startedAt: number | null;
  /**
   * Fired once when this screen's own 1s progress poll sees a terminal
   * status (ready/running/error). The parent's instance-polling loop is a
   * self-rescheduling timeout chain, so a single hung request kills it and
   * the user gets stuck on this screen until a manual reload; this poll
   * runs on a hang-proof interval and gives the transition a second path.
   */
  onTerminalStatus?: () => void;
}

const POLL_INTERVAL_MS = 1_000;

/**
 * Preview-mode mock ONLY. Real onboarding renders the orchestrator's polled
 * step list verbatim — it's a dynamic subset (integration/inbox/sokosumi
 * steps only appear when applicable) whose labels can change mid-run (e.g.
 * inbox_scan relabels itself when skipped), so nothing here may be used as
 * a template for live data. The orchestrator publishes the real list within
 * ~1s of onboarding start, so the pre-first-poll window is a single neutral
 * "warming up" line, not a fabricated list.
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

const PREVIEW_TICK_MS = 7_000;
const PREVIEW_TOTAL_SECONDS = 75;

/** After this many consecutive failed polls we surface a soft warning
 * instead of leaving the user staring at the warming-up line or last
 * checklist indefinitely. Three because a single hiccup is noise; three
 * in a row is something the user deserves to know about. */
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
      setState((prev) => ({
        progress: {
          status: result.value.status as ProgressShape["status"],
          // Keep the last non-empty list: the contract doesn't guarantee
          // steps on every poll (Core maps an absent array to []), and a
          // step-less 200 mid-run — or right at the terminal flip — must
          // not bounce the rendered checklist back to the warming-up line.
          // The ETA rides along: with no steps the orchestrator computes
          // etaSeconds as remaining × 25 = 0, so a step-less poll carries
          // no usable ETA either — adopting that 0 would flash
          // "Almost done…" during the 1–2 min machine boot.
          steps:
            result.value.steps.length > 0
              ? result.value.steps
              : prev.progress.steps,
          etaSeconds:
            result.value.steps.length > 0
              ? result.value.etaSeconds
              : prev.progress.etaSeconds,
        },
        pollError: false,
      }));
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
  startedAt,
  onTerminalStatus,
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
  const hints = useMemo(
    () => orderedMessageList(t.raw("hints") as Record<string, string>),
    [t],
  );
  const { progress, pollError } = useOnboardingProgress(
    previewMode,
    previewSequence,
  );
  // The polled steps are the source of truth, rendered verbatim: the
  // orchestrator emits a dynamic subset with its own labels/statuses, so
  // any local template would swap names mid-onboarding.
  const displaySteps = progress.steps;
  // Coarse, minute-granular ETA — the orchestrator now publishes a reliable
  // figure from the first poll, but a per-second countdown would jitter and
  // read as broken, so we round up and hand off to "almost done" copy.
  // Gated on a non-empty step list: an ETA derived from zero steps is a
  // fabrication, and its 0 would read "Almost done…" mid machine-boot.
  const hasSteps = displaySteps.length > 0;
  const etaMinutes =
    hasSteps && progress.etaSeconds !== null && progress.etaSeconds > 30
      ? Math.ceil(progress.etaSeconds / 60)
      : null;
  const showEtaSettling =
    hasSteps && progress.etaSeconds !== null && progress.etaSeconds <= 30;
  const elapsedSeconds = useElapsedSeconds(startedAt);
  const tProvisioning = useTranslations("App.Hermes.Provisioning");

  // Keep nudging (not fire-once): if the parent's recovery refetch itself
  // fails on a transient blip, the next nudge retries until the parent
  // transitions away and unmounts this screen.
  useEffect(() => {
    if (previewMode) return;
    const isTerminal =
      progress.status === "ready" ||
      progress.status === "running" ||
      progress.status === "error";
    if (!isTerminal) return;
    onTerminalStatus?.();
    const interval = window.setInterval(() => onTerminalStatus?.(), 2_000);
    return () => window.clearInterval(interval);
  }, [progress.status, previewMode, onTerminalStatus]);

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
        {/* ETA on the left (the first step legitimately runs 1–2 min while
            the machine boots — the ETA keeps that from reading as stuck),
            elapsed clock on the right matching the provisioning screen so
            the two setup phases read as one continuous process. */}
        <div className="mb-2 flex min-h-4 items-center justify-between gap-3">
          <span className="text-muted-foreground text-xs">
            {etaMinutes !== null
              ? t("etaMinutesLabel", { minutes: etaMinutes })
              : showEtaSettling
                ? t("etaSettling")
                : null}
          </span>
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            {tProvisioning("elapsedLabel", {
              elapsed: formatElapsed(elapsedSeconds),
            })}
          </span>
        </div>
        {displaySteps.length > 0 ? (
          <ol className="border-border/60 bg-card/40 flex flex-col overflow-hidden rounded-xl border">
            {displaySteps.map((step, index) => (
              <StepRow
                key={step.id}
                step={step}
                isLast={index === displaySteps.length - 1}
              />
            ))}
          </ol>
        ) : (
          /* Pre-first-poll (or an empty list from the orchestrator): one
             honest neutral line instead of a fabricated step list that the
             real rows would visibly replace. */
          <div className="border-border/60 bg-card/40 flex items-center gap-3 rounded-xl border px-5 py-4">
            <Loader2 className="text-primary size-4 animate-spin" aria-hidden />
            <span className="text-foreground text-sm">
              {t("stepFallbackLabel")}
            </span>
          </div>
        )}

        {/* Rotating hints keep the wait entertaining; the coarse minute-level
          ETA above carries the "how long" question. Per-step durations still
          vary (Composio MCP cold-start, Gmail inbox size), which is why the
          ETA is rounded rather than a per-second countdown. */}
        <div className="mt-4 flex min-h-8 items-center justify-center">
          <RotatingMessages
            messages={hints}
            intervalMs={5_500}
            className="text-muted-foreground max-w-md text-center text-xs leading-relaxed"
          />
        </div>

        {/* Surface persistent progress-poll failures rather than leaving the
            user staring at the warming-up line or last checklist forever.
            Soft inline notice, not a full error state, because the
            orchestrator usually recovers on its own and the parent's
            instance polling still catches the terminal status flip. */}
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
            // No line-through: skipped labels are status explanations under
            // the new contract ("Inbox not connected") and striking a
            // negative statement reads as its opposite. The dash glyph +
            // muted colour already say "not applicable".
            isSkipped && "text-muted-foreground/70",
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
