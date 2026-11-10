"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

/** Done (green, check), working (dashed, dot) or not yet (hairline). */
interface ChecklistItem {
  label: string;
  state: "done" | "working" | "next";
}

interface ChecklistProps {
  items: ChecklistItem[];
  /** "ob-chips" lays the same items out in a row. */
  className?: string;
}

export function Checklist({
  items,
  className = "ob-checklist",
}: ChecklistProps) {
  return (
    <ol className={className}>
      {items.map((item) => (
        <li key={item.label} className={item.state}>
          <span className="ob-box" aria-hidden="true">
            {item.state === "done" ? (
              <Check size={12} strokeWidth={3} />
            ) : item.state === "working" ? (
              <span className="ob-box-dot" />
            ) : null}
          </span>
          {item.label}
          <span className="ob-sr">
            {item.state === "done"
              ? ", done"
              : item.state === "working"
                ? ", in progress"
                : ", not yet"}
          </span>
        </li>
      ))}
    </ol>
  );
}

type Work = NonNullable<CmoOverview["work"]>;

/** Seconds since the work started, ticking while it runs. */
export function useElapsedSeconds(
  since: Date | string | undefined,
  running: boolean,
): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!running || !since) return null;
  return Math.max(0, Math.round((now - new Date(since).getTime()) / 1_000));
}

/** "12s so far", "4 min so far", "2 h so far". */
export function elapsedLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s so far`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min so far`;
  return `${Math.floor(minutes / 60)} h so far`;
}

export const RESEARCH_PHASES = [
  { kinds: ["read"], label: "Reading your site" },
  { kinds: ["search", "study"], label: "Comparing your competitors" },
  { kinds: ["brain"], label: "Writing your Brand Brain" },
] as const;

export const PLANNING_PHASES = [
  { kinds: ["other"], label: "Your channels" },
  { kinds: ["strategy"], label: "Four weeks, day by day" },
] as const;

/**
 * The work's steps as a checklist. A phase is done once a later one has
 * started, even when Cuso skipped it (no channels to check), so no step
 * stays unticked behind the active one.
 */
export function workChecklist(
  steps: Work["steps"],
  phases: readonly { kinds: readonly string[]; label: string }[],
  running: boolean,
): ChecklistItem[] {
  const touched = (at: number) =>
    steps.filter((step) => phases[at]?.kinds.includes(step.kind));
  const items = phases.map((phase, index) => {
    const mine = touched(index);
    const laterStarted = phases
      .slice(index + 1)
      .some((_, offset) => touched(index + 1 + offset).length > 0);
    const state: ChecklistItem["state"] = laterStarted
      ? "done"
      : mine.some((step) => step.status === "running")
        ? "working"
        : mine.length > 0
          ? index === phases.length - 1 && running
            ? "working"
            : "done"
          : "next";
    return { label: phase.label, state };
  });
  // Core reports a phase's first step a moment after the work starts; until
  // then the first phase not done is the one being worked on, never "next".
  if (running && !items.some((item) => item.state === "working")) {
    const first = items.find((item) => item.state === "next");
    if (first) first.state = "working";
  }
  return items;
}

/** A section Cuso has not saved yet: a dashed outline, never a shimmer. */
export function SkeletonTile() {
  return (
    <div className="ob-skeleton" aria-hidden="true">
      <span />
      <span />
    </div>
  );
}
