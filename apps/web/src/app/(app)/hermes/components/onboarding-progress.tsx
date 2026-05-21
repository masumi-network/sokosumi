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
  "Try: \"every weekday at 8am, send me my inbox brief.\"",
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
 * Mirrors the labels the orchestrator returns once it starts emitting
 * progress. Rendered with the first row showing a spinner so the user has
 * something to anchor on during the pre-first-poll gap — beats a single
 * "Working" line that suddenly grows to 5.
 */
const SKELETON_STEPS = [
  "Saving your details",
  "Connecting to your integrations",
  "Reading your inbox",
  "Checking your public profile",
  "Drafting your intro",
];

/**
 * Step sequence shown in preview mode (`?state=onboarding`). Mirrors the
 * shape the orchestrator returns so the design loop is faithful.
 */
const PREVIEW_SEQUENCE: HermesOnboardingStep[][] = [
  [
    { id: "memory", label: "Saving your details", status: "running" },
    { id: "inbox_scan", label: "Reading your inbox", status: "pending" },
    {
      id: "web_research",
      label: "Checking your public profile",
      status: "pending",
    },
    { id: "intro_draft", label: "Drafting your intro", status: "pending" },
  ],
  [
    { id: "memory", label: "Saving your details", status: "done" },
    { id: "inbox_scan", label: "Reading your inbox", status: "running" },
    {
      id: "web_research",
      label: "Checking your public profile",
      status: "pending",
    },
    { id: "intro_draft", label: "Drafting your intro", status: "pending" },
  ],
  [
    { id: "memory", label: "Saving your details", status: "done" },
    { id: "inbox_scan", label: "Reading your inbox", status: "done" },
    {
      id: "web_research",
      label: "Checking your public profile",
      status: "running",
    },
    { id: "intro_draft", label: "Drafting your intro", status: "pending" },
  ],
  [
    { id: "memory", label: "Saving your details", status: "done" },
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

function useOnboardingProgress(previewMode: boolean): ProgressShape {
  const [progress, setProgress] = useState<ProgressShape>(() => ({
    status: "onboarding",
    steps: previewMode ? PREVIEW_SEQUENCE[0]! : [],
    etaSeconds: previewMode ? PREVIEW_TOTAL_SECONDS : null,
  }));

  useEffect(() => {
    if (previewMode) {
      // Mock-drive the steps for design iteration.
      let tick = 0;
      const id = setInterval(() => {
        tick = Math.min(tick + 1, PREVIEW_SEQUENCE.length - 1);
        setProgress({
          status: "onboarding",
          steps: PREVIEW_SEQUENCE[tick]!,
          etaSeconds: Math.max(
            0,
            PREVIEW_TOTAL_SECONDS - tick * (PREVIEW_TICK_MS / 1000),
          ),
        });
      }, PREVIEW_TICK_MS);
      return () => clearInterval(id);
    }

    // Real-data path: poll the orchestrator-backed action every second.
    // The parent's instance polling will detect the status flip to `ready`
    // and unmount this component — no need to also branch off `status` here.
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      const result = await getHermesOnboardingProgressAction({});
      if (cancelled || !result.ok) return;
      setProgress({
        status: result.data.status as ProgressShape["status"],
        steps: result.data.steps,
        etaSeconds: result.data.etaSeconds,
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

  return progress;
}

export default function OnboardingProgress({
  previewMode,
}: OnboardingProgressProps) {
  const t = useTranslations("App.Hermes.OnboardingProgress");
  const progress = useOnboardingProgress(previewMode);

  return (
    <FlowBackground>
      <div className="mx-auto w-full max-w-2xl px-6 py-12 md:py-20">
      <ProgressPips current="personalizing" />

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div className="mb-10 flex flex-col items-center text-center md:mb-12">
        <div className="bg-card border-border/60 ring-border/40 relative size-16 overflow-hidden rounded-full border ring-4">
          <Image
            src="/images/hermes/avatar.png"
            alt=""
            fill
            sizes="64px"
            className="object-cover"
          />
        </div>
        <h1 className="text-foreground mt-6 text-3xl font-semibold tracking-tight md:text-4xl">
          {t("title")}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-xl text-base leading-relaxed">
          {t("subtitle")}
        </p>
      </div>

      {/* ── Steps ───────────────────────────────────────────────── */}
      {/*
        Before the orchestrator returns the real step list we render an
        animated skeleton with the labels we KNOW it will return — keeps
        the loader from snapping from a single "Warming things up" row to
        a full 5-step list, and gives the user something to read.
      */}
      <ol className="border-border/60 bg-card/40 flex flex-col rounded-xl border">
        {progress.steps.length === 0
          ? SKELETON_STEPS.map((label, index) => (
              <SkeletonRow
                key={label}
                label={label}
                isFirst={index === 0}
                isLast={index === SKELETON_STEPS.length - 1}
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
      <div className="mt-6 flex min-h-[2.5rem] items-center justify-center">
        <RotatingMessages
          messages={HINTS}
          intervalMs={5_500}
          className="text-muted-foreground max-w-md text-center text-xs leading-relaxed"
        />
      </div>
      <p className="text-muted-foreground/60 mt-2 text-center text-[11px]">
        This usually takes a couple of minutes. You can close this tab.
      </p>
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
        "flex flex-col gap-1 px-5 py-4 transition-colors",
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
  label,
  isFirst,
  isLast,
}: {
  label: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-5 py-4",
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
        className={cn(
          "text-sm",
          isFirst ? "text-foreground font-medium" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </li>
  );
}
