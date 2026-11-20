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
function settings(
  billing: Partial<CmoOverview["billing"]> = {},
  mayHire = false,
) {
  const overview = cmoOverview();
  return markup(billing, mayHire, overview).replace(/<[^>]+>/g, " ");
}

function markup(
  billing: Partial<CmoOverview["billing"]>,
  mayHire: boolean,
  overview = cmoOverview(),
) {
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
      setTimeZone={async () => null}
      signOut={async () => {}}
      topUp={null}
      plans={cmoPlans}
      changePlan={async () => ({ change: null, error: null })}
      openPortal={async () => ({ url: null, error: null })}
      subscribe={async () => ({ url: null, error: null })}
      mayHire={mayHire}
    />,
  );
}

describe("Settings: another website and starting over", () => {
  it("offers a second Cuso as a link to the hire form, apart from Start over", () => {
    const html = markup({}, true);
    const hire = html.indexOf('href="/?hire=1"');
    const stop = html.indexOf(`Stop this ${AGENT_NAME}`);
    expect(hire).toBeGreaterThan(-1);
    expect(html).toContain(`Hire ${AGENT_NAME} for another website`);
    expect(html).toContain("This one keeps working.");
    // Start over archives this Cuso: its own section, after the hire offer.
    expect(stop).toBeGreaterThan(hire);
    const another = html.slice(html.indexOf("Another website"), stop);
    expect(another).not.toContain("Start over");
    expect(html.slice(stop)).toContain("Start over");
    expect(html.slice(stop)).toContain("his unsent posts are canceled");
  });

  it("leaves the hire offer out for a person who may not hire", () => {
    const text = settings();
    expect(text).not.toContain("Another website");
    expect(text).not.toContain("/?hire=1");
    expect(text).toContain("Start over");
  });
});

describe("Settings: the time zone", () => {
  it("says which time zone Cuso's routines run in, and offers to change it", () => {
    const overview = cmoOverview();
    const text = renderToStaticMarkup(
      <SettingsPage
        overview={{ ...overview, timeZone: "America/Los_Angeles" }}
        compose={() => {}}
        name="Ada"
        email="ada@acme.io"
        startOver={async () => null}
        setTimeZone={async () => null}
        signOut={async () => {}}
        topUp={null}
        plans={cmoPlans}
        changePlan={async () => ({ change: null, error: null })}
        openPortal={async () => ({ url: null, error: null })}
        subscribe={async () => ({ url: null, error: null })}
      />,
    ).replace(/<[^>]+>/g, " ");
    expect(text).toContain(`${AGENT_NAME} works on America/Los Angeles time.`);
    expect(text).toContain("Change");
  });
});

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
    expect(text).not.toContain("Tester credits");
  });

  it("lets a Cuso with Tester credits subscribe and keep them", () => {
    const text = settings({ hasTesterCredits: true });

    expect(text).toContain("Subscribe");
    expect(text).toContain("You keep the credits you have");
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

  it("shows a pending downgrade and the way to keep the plan", () => {
    const text = settings({ ...owner, pendingTier: "starter" });

    expect(text).toContain("Moves to Starter on 13 January 2027.");
    expect(text).toContain("Keep my plan");
  });

  it("offers no Keep my plan without a pending downgrade", () => {
    expect(settings(owner)).not.toContain("Keep my plan");
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
    expect(text).not.toContain("Keep my plan");
    expect(text).not.toContain("Manage billing");
  });
});
