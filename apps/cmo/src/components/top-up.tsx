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
}: {
  topUp: StartTopUp | null;
  subscribe?: StartTopUp | null;
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
    </>
  );
}
