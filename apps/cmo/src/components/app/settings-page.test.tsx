import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AGENT_NAME } from "../../lib/agent";
import { cmoOverview, cmoPlans } from "../../test-fixtures/cmo";
import { SettingsPage } from "./pages";

const SUBSCRIBED = {
  tier: "growth",
  interval: "month",
  status: "active",
  periodEnd: new Date("2027-01-13T10:00:00.000Z"),
  cancelAtPeriodEnd: false,
} as const;

/** The Settings page's text for a Cuso with this billing block. */
function settings(billing: Partial<CmoOverview["billing"]> = {}) {
  const overview = cmoOverview();
  return renderToStaticMarkup(
    <SettingsPage
      overview={{
        ...overview,
        billing: { ...overview.billing, availableCredits: 8400.7, ...billing },
      }}
      compose={() => {}}
      name="Ada"
      email="ada@acme.io"
      startOver={async () => null}
      signOut={async () => {}}
      topUp={null}
      plans={cmoPlans}
      changePlan={async () => ({ change: null, error: null })}
      openPortal={async () => ({ url: null, error: null })}
      subscribe={async () => ({ url: null, error: null })}
    />,
  ).replace(/<[^>]+>/g, " ");
}

describe("Settings: the CMO subscription", () => {
  it("shows the tier, the interval, the renewal date and the credits left", () => {
    const text = settings(SUBSCRIBED);

    expect(text).toContain("Growth");
    expect(text).toContain("billed monthly");
    expect(text).toContain("Renews on 13 January 2027.");
    expect(text).toContain("8400");
    expect(text).toContain("credits available");
    expect(text).not.toContain("payment failed");
  });

  it("says yearly for a yearly plan", () => {
    expect(settings({ ...SUBSCRIBED, interval: "year" })).toContain(
      "billed yearly",
    );
  });

  it("shows the end date instead of a renewal once a cancel is scheduled", () => {
    const text = settings({ ...SUBSCRIBED, cancelAtPeriodEnd: true });

    expect(text).toContain(
      `Ends on 13 January 2027. ${AGENT_NAME} works until then.`,
    );
    expect(text).not.toContain("Renews on");
  });

  it("names the failed payment when the subscription is past due", () => {
    const text = settings({ ...SUBSCRIBED, status: "past_due" });

    expect(text).toContain("The last payment failed.");
    expect(text).toContain("Growth");
    expect(text).not.toContain("Renews on");
  });

  it("offers the plan checkout without a subscription", () => {
    const text = settings();

    expect(text).toContain("8400");
    expect(text).toContain("No CMO plan yet");
    expect(text).toContain("Subscribe");
    expect(text).not.toContain("Renews on");
    expect(text).not.toContain("payment failed");
    expect(text).not.toContain("Starter credits");
  });

  it("lets a Cuso with Starter credits subscribe and keep them", () => {
    const text = settings({ hiredWithStarterCredits: true });

    expect(text).toContain("Subscribe");
    expect(text).toContain("Your Starter credits stay");
  });
});

describe("Settings: changing the plan and the billing portal", () => {
  const owner = { ...SUBSCRIBED, viewerCanManage: true };

  it("offers an owner or admin the other plans of the interval, by credits", () => {
    const text = settings(owner);

    expect(text).toContain("Move to Starter");
    expect(text).toContain("Move to Scale");
    expect(text).not.toContain("Move to Growth");
    expect(text.indexOf("Move to Starter")).toBeLessThan(
      text.indexOf("Move to Scale"),
    );
    expect(text).toContain("50,000 credits a month");
    expect(text).toContain("Manage billing");
  });

  it("offers the yearly plans on a yearly subscription", () => {
    const text = settings({ ...owner, interval: "year" });

    expect(text).toContain("Move to Scale");
    expect(text).toContain("$10,000 a year");
    expect(text).not.toContain("$1,000 a month");
  });

  it("shows a pending downgrade", () => {
    expect(settings({ ...owner, pendingTier: "starter" })).toContain(
      "Moves to Starter on 13 January 2027.",
    );
  });

  it("keeps the portal but no plan change while past due or cancelled", () => {
    for (const billing of [
      { ...owner, status: "past_due" },
      { ...owner, cancelAtPeriodEnd: true },
    ]) {
      const text = settings(billing);

      expect(text).not.toContain("Move to");
      expect(text).toContain("Manage billing");
    }
  });

  it("shows other members neither the plan change, the pending downgrade nor the portal", () => {
    const text = settings({
      ...SUBSCRIBED,
      pendingTier: "starter",
      viewerCanManage: false,
    });

    expect(text).toContain("Growth");
    expect(text).not.toContain("Move to");
    expect(text).not.toContain("Moves to Starter");
    expect(text).not.toContain("Manage billing");
  });
});
