"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, CalendarDays } from "lucide-react";
import { useTransition } from "react";

import { formatDay } from "../../lib/calendar";
import { StrategyReveal } from "../strategy-reveal";

interface StrategyVersionsProps {
  overview: CmoOverview;
  onApprove?: (versionId: string) => Promise<void>;
}

/**
 * Every version of the strategy, newest first. The approved one is what
 * Cuso carries out; owners and admins go back to an earlier one by
 * approving it again.
 */
export function StrategyVersions({
  overview,
  onApprove,
}: StrategyVersionsProps) {
  const [pending, startTransition] = useTransition();
  const versions = overview.strategyVersions;
  if (versions.length < 2) return null;
  return (
    <section className="plan-week" aria-label="Versions">
      <p className="plan-week-head">
        <b>Versions</b>
      </p>
      <ul className="plan-items">
        {versions.map((version, index) => (
          <li key={version.id} className="plan-item">
            <span className="plan-day num">
              {formatDay(version.createdAt.toISOString().slice(0, 10), {
                day: "numeric",
                month: "short",
              })}
            </span>
            <span className="plan-item-title">
              {index === 0 ? "Newest" : `Version ${versions.length - index}`}
            </span>
            {version.approvedAt ? (
              <span className="tag ok">Approved</span>
            ) : overview.viewerCanApprove && onApprove ? (
              <button
                type="button"
                className="button button-secondary button-small"
                disabled={pending}
                onClick={() => startTransition(() => onApprove(version.id))}
              >
                {index === 0
                  ? "Approve this version"
                  : "Go back to this version"}
              </button>
            ) : (
              <span className="tag">Draft</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The plan: what Cuso does and why. The pieces themselves live on the
 * Calendar page, one link away.
 */
export function StrategyPage({
  overview,
  onAsk,
  onOpenCalendar,
  onSetAds,
  onApprove,
}: {
  overview: CmoOverview;
  onAsk: (text: string) => Promise<void>;
  onOpenCalendar: () => void;
  onSetAds?: (monthly: number, currency: string) => Promise<void>;
  /** Approves an earlier version again: Cuso goes back to that plan. */
  onApprove?: (versionId: string) => Promise<void>;
}) {
  const strategy = overview.strategy;
  if (!strategy) {
    return (
      <div className="empty">
        <span className="shape" aria-hidden="true" />
        <span>Cuso is still writing the strategy.</span>
      </div>
    );
  }
  const pieces = strategy.calendar.filter(
    (entry) => entry.status !== "skipped",
  ).length;

  return (
    <div className="plan">
      <StrategyReveal
        overview={overview}
        onAsk={onAsk}
        onSetAds={onSetAds}
        calendar={
          <button
            type="button"
            className="button button-secondary"
            onClick={onOpenCalendar}
          >
            <CalendarDays size={15} aria-hidden="true" />
            See all {pieces} pieces in your calendar
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        }
      />

      <StrategyVersions overview={overview} onApprove={onApprove} />
    </div>
  );
}
