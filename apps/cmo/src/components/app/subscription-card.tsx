import type { CmoOverview } from "@sokosumi/core-client";

import { AGENT_NAME } from "../../lib/agent";

/**
 * Settings: the Cuso's CMO subscription, straight from the overview. Renders
 * nothing without one; the credits sit in the card below.
 */
export function SubscriptionCard({
  billing,
}: {
  billing: CmoOverview["billing"];
}) {
  const { tier, interval, periodEnd } = billing;
  if (!tier) return null;
  const date = periodEnd?.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <section className="card">
      <h3>Subscription</h3>
      <div className="li">
        <span className="grow">
          {/* The tier's slug is Polar's; only its first letter is ours. */}
          <span className="v">
            {tier.charAt(0).toUpperCase() + tier.slice(1)}
          </span>{" "}
          <span className="note">
            billed {interval === "year" ? "yearly" : "monthly"}
          </span>
        </span>
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
    </section>
  );
}
