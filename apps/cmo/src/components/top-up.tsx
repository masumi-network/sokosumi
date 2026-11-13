"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { useState, useTransition } from "react";

/** Starts the top-up checkout: where the browser goes, or why it did not start. */
export type StartTopUp = () => Promise<{
  url: string | null;
  error: string | null;
}>;

/**
 * The top-up for this Cuso, or null when he may not have one: a Project
 * top-up is sold only for a Cuso with an active CMO subscription (ADR 0068).
 */
export function topUpOffer(
  overview: Pick<CmoOverview, "billing">,
  startTopUp: StartTopUp,
): StartTopUp | null {
  return overview.billing.status === "active" ? startTopUp : null;
}

/** Opens the top-up checkout for this Cuso (or, labelled, the plan checkout). */
export function TopUpButton({
  startTopUp,
  className = "button button-small",
  label = "Top up",
}: {
  startTopUp: StartTopUp;
  className?: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await startTopUp();
            if (result.url) {
              window.location.assign(result.url);
              return;
            }
            setError(result.error ?? "Could not open the checkout. Try again.");
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

/**
 * Out of credits, with the top-up when this Cuso may have one, else the plan
 * checkout when he has no CMO plan (never a top-up without one).
 */
export function OutOfCredits({
  topUp,
  subscribe = null,
  skip = null,
}: {
  topUp: StartTopUp | null;
  subscribe?: StartTopUp | null;
  /** Without a top-up: a tester continues without a subscription. */
  skip?: SkipSubscription | null;
}) {
  const offer = topUp ?? subscribe;
  return (
    <>
      <span className="note" role="alert">
        You're out of credits.
        {topUp
          ? " Top up, then try again."
          : subscribe
            ? " Subscribe to a CMO plan, then try again."
            : ""}
      </span>
      {offer ? (
        <TopUpButton
          startTopUp={offer}
          className="button button-secondary button-small"
          label={topUp ? "Top up" : "Subscribe"}
        />
      ) : null}
      {!topUp && skip ? <SkipSubscriptionButton skip={skip} /> : null}
    </>
  );
}

/** Continues a Cuso without a subscription; a refusal comes back as text. */
export type SkipSubscription = () => Promise<string | null>;

/**
 * The skip for this Cuso, or null: Core says whether this person, a tester,
 * may continue him without a subscription now (ADR 0068).
 */
export function skipOffer(
  overview: Pick<CmoOverview, "billing">,
  skip: SkipSubscription,
): SkipSubscription | null {
  return overview.billing.maySkipSubscription ? skip : null;
}

/** The testers' quiet way past the subscription. */
export function SkipSubscriptionButton({ skip }: { skip: SkipSubscription }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="button button-ghost button-small"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(await skip());
          })
        }
      >
        {pending ? "Continuing…" : "Continue without a subscription (testers)"}
      </button>
      {error ? (
        <span className="note" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
