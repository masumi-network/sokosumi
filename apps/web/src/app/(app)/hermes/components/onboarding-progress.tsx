"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import FlowBackground from "@/app/hermes/components/flow-background";
import ProgressPips from "@/app/hermes/components/progress-pips";
import RotatingMessages from "@/app/hermes/components/rotating-messages";

const HINTS = [
  "Pro tip: ask \"what's important in my inbox today?\" once you're in.",
  "Hermes remembers your projects, your contacts, your preferences.",
  'Try: "every weekday at 8am, send me my inbox brief."',
  "Hermes can hire other Sokosumi agents to help with research.",
  "Connect more tools later from Settings — Slack, Linear, Notion, more.",
  "Every morning Hermes will send a brief of what needs your attention.",
] as const;

import { getHermesOnboardingProgressAction } from "@/lib/actions/hermes";
import type {
  HermesOnboardingStep,
  HermesOnboardingProgress as ProgressShape,
} from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

interface OnboardingProgressProps {
  previewMode: boolean;
}

const POLL_INTERVAL_MS = 1_000;

/**
 * Skeleton row count shown before the first poll returns. We render shimmer
 * placeholders (not text) so when the orchestrator hands us real labels the
 * transition reads as "loading → loaded" instead of one label visibly
 * swapping to another — which looks like a bug.
 */
const SKELETON_STEP_COUNT = 5;

/**
 * Step sequence shown in preview mode (`?state=onboarding`). Mirrors the
 * shape the orchestrator returns so the design loop is faithful.
 */
const PREVIEW_SEQUENCE: HermesOnboardingStep[][] = [
  [
    {
      id: "memory",
      label: "Bootstrapping your private memory",
      status: "running",
    },
    { id: "inbox_scan", label: "Reading your inbox", status: "pending" },
    {
      id: "web_research",
      label: "Checking your public profile",
      status: "pending",
    },
    { id: "intro_draft", label: "Drafting your intro", status: "pending" },
  ],
  [
    {
      id: "memory",
      label: "Bootstrapping your private memory",
      status: "done",
    },
    { id: "inbox_scan", label: "Reading your inbox", status: "running" },
    {
      id: "web_research",
      label: "Checking your public profile",
      status: "pending",
    },
    { id: "intro_draft", label: "Drafting your intro", status: "pending" },
  ],
  [
    {
      id: "memory",
      label: "Bootstrapping your private memory",
      status: "done",
    },
    { id: "inbox_scan", label: "Reading your inbox", status: "done" },
    {
      id: "web_research",
      label: "Checking your public profile",
      status: "running",
    },
    { id: "intro_draft", label: "Drafting your intro", status: "pending" },
  ],
  [
    {
      id: "memory",
      label: "Bootstrapping your private memory",
      status: "done",
    },
    { id: "inbox_scan", label: "Reading your inbox", status: "done" },
    {
      id: "web_research",
      label: "Checking your public profile",
      status: "done",
    },
    { id: "intro_draft", label: "Drafting your intro", status: "running" },
  ],
];
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

function useOnboardingProgress(previewMode: boolean): ProgressState {
  const [state, setState] = useState<ProgressState>(() => ({
    progress: {
      status: "onboarding",
      steps: previewMode ? PREVIEW_SEQUENCE[0]! : [],
      etaSeconds: previewMode ? PREVIEW_TOTAL_SECONDS : null,
    },
    pollError: false,
  }));

  useEffect(() => {
    if (previewMode) {
      // Mock-drive the steps for design iteration.
      let tick = 0;
      const id = setInterval(() => {
        tick = Math.min(tick + 1, PREVIEW_SEQUENCE.length - 1);
        setState({
          progress: {
            status: "onboarding",
            steps: PREVIEW_SEQUENCE[tick]!,
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
  }, [previewMode]);

  return state;
}

export default function OnboardingProgress({
  previewMode,
}: OnboardingProgressProps) {
  const t = useTranslations("App.Hermes.OnboardingProgress");
  const { progress, pollError } = useOnboardingProgress(previewMode);

  return (
    <FlowBackground className="flex h-full flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-4 md:py-6">
        <ProgressPips current="personalizing" />

        {/* ── Hero ────────────────────────────────────────────────── */}
        <div className="mb-6 flex flex-col items-center text-center md:mb-8">
          <div className="bg-card border-border/60 ring-border/40 relative size-14 overflow-hidden rounded-full border ring-4">
            <Image
              src="/images/hermes/avatar.png"
              alt=""
              fill
              sizes="56px"
              className="object-cover"
            />
          </div>
          <h1 className="text-foreground mt-4 text-2xl font-semibold tracking-tight md:text-3xl">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
            {t("subtitle")}
          </p>
        </div>

        {/* ── Steps ───────────────────────────────────────────────── */}
        {/*
        Before the orchestrator returns the real step list we render
        shimmer placeholders (not text). When real labels arrive the
        transition reads as loading→loaded, never as text swapping.
      */}
        <ol className="border-border/60 bg-card/40 flex flex-col rounded-xl border">
          {progress.steps.length === 0
            ? Array.from({ length: SKELETON_STEP_COUNT }).map((_, index) => (
                <SkeletonRow
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  isFirst={index === 0}
                  isLast={index === SKELETON_STEP_COUNT - 1}
                />
              ))
            : progress.steps.map((step, index) => (
                <StepRow
                  key={step.id}
                  step={step}
                  isLast={index === progress.steps.length - 1}
                />
              ))}
        </ol>

        {/* Rotating hint instead of the misleading countdown. The orchestrator
          ETA is wildly variable (Composio MCP cold-start, OAuth verification,
          Gmail inbox size) so a per-second number reads as broken when it
          inevitably drifts. Honest copy + something fun to read. */}
        <div className="mt-4 flex min-h-[2rem] items-center justify-center">
          <RotatingMessages
            messages={HINTS}
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
          <div className="border-amber-500/30 bg-amber-500/[0.06] text-amber-700 dark:text-amber-400 mx-auto mt-3 flex max-w-md items-center gap-2 rounded-lg border px-3 py-2">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            <p className="text-xs leading-relaxed">
              Can't reach the orchestrator right now — still trying.
            </p>
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
            !isDone &&
              !isActive &&
              !isError &&
              "bg-muted text-muted-foreground/60",
          )}
        >
          {isDone ? (
            <Check className="size-3.5" />
          ) : isActive ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : isError ? (
            <AlertCircle className="size-3.5" />
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
            !isDone && !isActive && !isError && "text-muted-foreground",
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

function SkeletonRow({
  isFirst,
  isLast,
}: {
  isFirst: boolean;
  isLast: boolean;
}) {
  // Vary the placeholder bar width so the column doesn't look like a barcode.
  const widths = ["w-2/3", "w-1/2", "w-3/5", "w-2/5", "w-1/2"];
  const width = isFirst ? widths[0] : widths[(isLast ? 4 : 2) % widths.length];
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-5 py-3",
        !isLast && "border-border/60 border-b",
        isFirst && "bg-card",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          isFirst ? "bg-primary/10 text-primary" : "bg-muted",
        )}
      >
        {isFirst ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <span className="bg-muted-foreground/40 size-1.5 rounded-full" />
        )}
      </span>
      <span
        aria-hidden
        className={cn(
          "bg-muted-foreground/15 h-3 rounded-full",
          isFirst ? "animate-pulse" : "opacity-60",
          width,
        )}
      />
    </li>
  );
}
