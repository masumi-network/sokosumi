"use client";

import type { CmoSubscriptionPlan } from "@sokosumi/core-client";
import { ArrowRight, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { AGENT_NAME } from "../../lib/agent";
import { CusoAvatar } from "../cuso";
import { money } from "../strategy-core";
import { type SkipSubscription, SkipSubscriptionButton } from "../top-up";
import type { CheckoutPhase } from "./step";

type Interval = CmoSubscriptionPlan["interval"];

const INTERVALS: { id: Interval; label: string; per: string }[] = [
  { id: "month", label: "Monthly", per: "a month" },
  { id: "year", label: "Yearly", per: "a year" },
];

/** A plan's price in its currency's main unit. */
function price(plan: CmoSubscriptionPlan, months = 1): string {
  return money(plan.priceAmount / 100 / months, plan.currency.toUpperCase());
}

interface CheckoutStepProps {
  /** The CMO plans as Core lists them; empty when they could not be read. */
  plans: CmoSubscriptionPlan[];
  phase: CheckoutPhase;
  /** Starts Polar's checkout; the browser goes to the returned URL. */
  onCheckout: (
    interval: Interval,
    tier: string,
  ) => Promise<{ url: string | null; error: string | null }>;
  /** Back from the confirming state to the plans. */
  onShowPlans: () => void;
  /** Continues without a subscription, for a tester Core allows it. */
  skip?: SkipSubscription | null;
}

/**
 * The last step of hiring (ADR 0068): the CMO plans of one interval, then
 * Polar's hosted checkout, where the person can still switch plans. Back
 * from Polar it waits for the payment's confirmation; the flow opens the
 * chat once the subscription shows.
 */
export function CheckoutStep({
  plans,
  phase,
  onCheckout,
  onShowPlans,
  skip = null,
}: CheckoutStepProps) {
  const [interval, setInterval] = useState<Interval>("month");
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();

  if (phase === "confirming") {
    return (
      <section className="ob-launch">
        <CusoAvatar pose="thinking" size={96} />
        <h1 className="ob-h1">Almost there.</h1>
        <p className="ob-confirming" role="status">
          <Loader2 size={16} className="spin" aria-hidden="true" />
          Confirming your payment. This page opens the chat as soon as it is
          through.
        </p>
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={onShowPlans}
        >
          I haven't paid, show the plans
        </button>
      </section>
    );
  }

  const offered = plans.filter((plan) => plan.interval === interval);
  // The cheapest plan until the person picks one; a pick carries over to the
  // other interval, which sells the same tiers.
  const tier =
    offered.find((plan) => plan.tier === picked)?.tier ?? offered[0]?.tier;

  function checkout(chosen: string) {
    setError(null);
    startOpening(async () => {
      try {
        const result = await onCheckout(interval, chosen);
        if (result.url) {
          window.location.assign(result.url);
          return;
        }
        setError(result.error ?? "Could not open the checkout. Try again.");
      } catch {
        setError("Could not open the checkout. Try again.");
      }
    });
  }

  return (
    <section className="ob-checkout">
      <CusoAvatar pose="done" size={96} />
      <h1 className="ob-h1">Pick a plan, then I start.</h1>
      <p className="muted">
        Every plan gives {AGENT_NAME} credits each month to make and post your
        marketing. Credits left at the end of a month expire.
      </p>

      {plans.length === 0 ? (
        <p className="alert" role="alert">
          Plans aren't available right now. Reload the page to try again.
        </p>
      ) : (
        <>
          <div className="ob-tabs" role="group" aria-label="Billing">
            {INTERVALS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={interval === option.id}
                onClick={() => setInterval(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="panel">
            <div className="ob-plan-options" role="group" aria-label="Plan">
              {offered.map((plan) => (
                <button
                  key={plan.tier}
                  type="button"
                  aria-pressed={plan.tier === tier}
                  className="card ob-plan-option"
                  onClick={() => setPicked(plan.tier)}
                >
                  <span className="ob-plan-name">{plan.name}</span>
                  <span className="ob-value">
                    {price(plan)}{" "}
                    <span className="ob-small muted">
                      {INTERVALS.find((option) => option.id === interval)?.per}
                    </span>
                  </span>
                  <span className="ob-small">
                    {plan.credits.toLocaleString("en")} credits every month
                  </span>
                  {interval === "year" ? (
                    <span className="ob-small muted">
                      {price(plan, 12)} a month, paid once a year
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p className="alert" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            className="button ob-wide"
            disabled={opening || !tier}
            onClick={() => tier && checkout(tier)}
          >
            {opening ? "Opening checkout…" : "Continue to payment"}
            {opening ? null : <ArrowRight size={16} aria-hidden="true" />}
          </button>
          <p className="ob-small muted">
            You pay on Polar's checkout page, where you can still switch plans.
          </p>
          {skip ? <SkipSubscriptionButton skip={skip} /> : null}
        </>
      )}
    </section>
  );
}
