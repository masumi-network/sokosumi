"use client";

import type { CmoOverview, CmoSubscriptionPlan } from "@sokosumi/core-client";
import { useState, useTransition } from "react";

import { AGENT_NAME } from "../../lib/agent";
import { money } from "../strategy-core";
import { type StartTopUp, TopUpButton } from "../top-up";

/**
 * Moves the Cuso to a tier of his interval: what changed, or why not. His
 * current tier while a downgrade is pending keeps the plan.
 */
export type ChangePlan = (tier: string) => Promise<{
  change: "upgrade" | "downgrade" | "kept" | null;
  error: string | null;
}>;

/** Opens Polar's customer portal: where the browser goes, or why not. */
export type OpenPortal = () => Promise<{
  url: string | null;
  error: string | null;
}>;

/** The tier's slug is Polar's; only its first letter is ours. */
function tierName(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/**
 * Settings: the Cuso's CMO subscription, straight from the overview. Without
 * one it offers the plan checkout (a Cuso with Tester credits keeps
 * them); the credits sit in the card below. Owners and admins
 * also see a pending downgrade, the other plans of the interval and the link
 * to Polar's customer portal; other members see none of them.
 */
export function SubscriptionCard({
  billing,
  plans,
  changePlan,
  openPortal,
  subscribe,
}: {
  billing: CmoOverview["billing"];
  /** The CMO plans as Core lists them: by interval, each by credits. */
  plans: CmoSubscriptionPlan[];
  changePlan: ChangePlan;
  openPortal: OpenPortal;
  /** Starts the CMO plan checkout; any member may pay. */
  subscribe: StartTopUp;
}) {
  const { tier, interval, periodEnd } = billing;
  if (!tier) {
    return (
      <section className="card">
        <h3>Subscription</h3>
        <div className="li">
          <span className="grow">
            <span className="v">No CMO plan yet</span>
          </span>
          <TopUpButton
            startTopUp={subscribe}
            label="Subscribe"
            className="button button-secondary button-small"
          />
        </div>
        {billing.hasTesterCredits ? (
          <p className="note">
            Your Tester credits stay. {AGENT_NAME} spends the plan's monthly
            credits first, then them.
          </p>
        ) : null}
      </section>
    );
  }
  const date = periodEnd?.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const manage = billing.viewerCanManage;
  // Polar changes the plan only of a running subscription that is not
  // cancelled; the portal fixes the payment or undoes the cancel first.
  const changeable =
    manage && billing.status === "active" && !billing.cancelAtPeriodEnd;
  return (
    <section className="card">
      <h3>Subscription</h3>
      <div className="li">
        <span className="grow">
          <span className="v">{tierName(tier)}</span>{" "}
          <span className="note">
            billed {interval === "year" ? "yearly" : "monthly"}
          </span>
        </span>
        {manage ? <PortalButton openPortal={openPortal} /> : null}
      </div>
      {billing.status === "past_due" ? (
        <p className="alert" role="alert">
          The last payment failed. {AGENT_NAME} is paused until it goes through;
          the month's credits arrive then.
        </p>
      ) : date ? (
        <p className="note">
          {billing.cancelAtPeriodEnd
            ? `Ends on ${date}. ${AGENT_NAME} works until then.`
            : `Renews on ${date}.`}
        </p>
      ) : null}
      {manage && billing.pendingTier && date ? (
        <KeepPlan
          notice={`Moves to ${tierName(billing.pendingTier)} on ${date}.`}
          tier={tier}
          changePlan={changePlan}
        />
      ) : null}
      {changeable ? (
        <PlanChange
          current={tier}
          plans={plans.filter(
            (plan) => plan.interval === interval && plan.tier !== tier,
          )}
          currentCredits={
            plans.find(
              (plan) => plan.interval === interval && plan.tier === tier,
            )?.credits ?? 0
          }
          changePlan={changePlan}
        />
      ) : null}
    </section>
  );
}

export function PortalButton({
  openPortal,
  label = "Manage billing",
}: {
  openPortal: OpenPortal;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="button button-secondary button-small"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await openPortal();
            if (result.url) {
              window.location.assign(result.url);
              return;
            }
            setError(result.error ?? "Could not open billing. Try again.");
          })
        }
      >
        {pending ? "Opening…" : label}
      </button>
      {error ? (
        <span className="note" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}

/** The pending downgrade, and the button that drops it. */
function KeepPlan({
  notice,
  tier,
  changePlan,
}: {
  notice: string;
  tier: string;
  changePlan: ChangePlan;
}) {
  const [kept, setKept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (kept) {
    return <p className="note">{tierName(tier)} stays your plan.</p>;
  }
  return (
    <>
      <div className="li">
        <span className="grow note">{notice}</span>
        <button
          type="button"
          className="button button-secondary button-small"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await changePlan(tier);
              if (result.change === "kept") {
                setKept(true);
                return;
              }
              setError(result.error ?? "Could not keep the plan. Try again.");
            })
          }
        >
          {pending ? "Keeping…" : "Keep my plan"}
        </button>
      </div>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** The other plans of the interval; a pick is confirmed before Polar charges. */
function PlanChange({
  current,
  currentCredits,
  plans,
  changePlan,
}: {
  current: string;
  currentCredits: number;
  plans: CmoSubscriptionPlan[];
  changePlan: ChangePlan;
}) {
  const [picked, setPicked] = useState<CmoSubscriptionPlan | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (plans.length === 0) return null;
  const upgrade = picked ? picked.credits > currentCredits : false;
  return (
    <>
      <ul className="list">
        {plans.map((plan) => (
          <li key={plan.tier} className="li">
            <span className="grow">
              <b>{plan.name}</b>
              <br />
              <span className="note">
                {plan.credits.toLocaleString("en")} credits a month,{" "}
                {money(plan.priceAmount / 100, plan.currency.toUpperCase())}{" "}
                {plan.interval === "year" ? "a year" : "a month"}
              </span>
            </span>
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={pending}
              onClick={() => {
                setPicked(plan);
                setDone(null);
                setError(null);
              }}
            >
              Move to {plan.name}
            </button>
          </li>
        ))}
      </ul>
      {picked ? (
        <div className="li">
          <span className="grow note">
            {upgrade
              ? `${picked.name} starts now. Polar charges the difference for the rest of the period, and the extra credits for this month arrive with the payment.`
              : `${picked.name} starts at the next renewal. Until then ${AGENT_NAME} keeps ${tierName(current)}.`}
          </span>
          <button
            type="button"
            className="button button-small"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await changePlan(picked.tier);
                if (result.change) {
                  setDone(
                    result.change === "upgrade"
                      ? `Moved to ${picked.name}.`
                      : `${picked.name} is set for the next renewal.`,
                  );
                  setPicked(null);
                  return;
                }
                setError(
                  result.error ?? "Could not change the plan. Try again.",
                );
              })
            }
          >
            {pending ? "Changing…" : upgrade ? "Upgrade now" : "Downgrade"}
          </button>
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={pending}
            onClick={() => setPicked(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {done ? <p className="note">{done}</p> : null}
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
