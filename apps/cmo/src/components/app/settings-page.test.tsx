import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AGENT_NAME } from "../../lib/agent";
import { cmoOverview } from "../../test-fixtures/cmo";
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

  it("shows only the credits without a subscription", () => {
    const text = settings();

    expect(text).toContain("8400");
    expect(text).not.toContain("Subscription");
    expect(text).not.toContain("Renews on");
    expect(text).not.toContain("payment failed");
  });
});
