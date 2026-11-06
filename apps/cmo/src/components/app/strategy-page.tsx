"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, CalendarDays } from "lucide-react";
import { useTransition } from "react";
import { AGENT_NAME } from "../../lib/agent";
import { formatDay } from "../../lib/calendar";
import { PlanReview } from "../onboarding/plan-step";
import type { ConnectMeasurement } from "../onboarding/plan-tabs";
import { StatusText } from "../status";

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
    <section className="card plan-week" aria-label="Versions">
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
              <StatusText>Approved</StatusText>
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
              <span className="muted">Draft</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface StrategyPageProps {
  overview: CmoOverview;
  onOpenCalendar: () => void;
  connectMeasurement: ConnectMeasurement;
  /** Approves an earlier version again: Cuso goes back to that plan. */
  onApprove?: (versionId: string) => Promise<void>;
}

/**
 * The plan as the hiring review shows it, read-only: the goal, what was
 * checked and the tabs. The pieces themselves live on the Calendar page.
 */
export function StrategyPage({
  overview,
  onOpenCalendar,
  connectMeasurement,
  onApprove,
}: StrategyPageProps) {
  const strategy = overview.strategy;
  if (!strategy) {
    return (
      <div className="empty">
        <span className="shape" aria-hidden="true" />
        <span>{AGENT_NAME} is still writing the strategy.</span>
      </div>
    );
  }
  const pieces = strategy.calendar.filter(
    (entry) => entry.status !== "skipped",
  ).length;

  return (
    <div className="plan">
      <PlanReview
        overview={overview}
        readOnly
        onRequest={async () => null}
        onSetAds={async () => null}
        onAnswer={async () => {}}
        onUpdate={async () => null}
        onApprove={async () => {}}
        onConnectMeasurement={connectMeasurement}
      />
      <div className="panel">
        <button
          type="button"
          className="button button-secondary"
          onClick={onOpenCalendar}
        >
          <CalendarDays size={15} aria-hidden="true" />
          See all {pieces} pieces in your calendar
          <ArrowRight size={15} aria-hidden="true" />
        </button>
        <StrategyVersions overview={overview} onApprove={onApprove} />
      </div>
    </div>
  );
}
