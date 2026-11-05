import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { planWeeks } from "../../lib/calendar";
import { cmoStrategyVersion } from "../../test-fixtures/cmo";
import {
  asking,
  brain,
  draft,
  reading,
  strategy,
  work,
} from "../../test-fixtures/onboarding";
import { Onboarding } from "../onboarding";
import { feedScreens } from "../phone-feeds";
import { showcaseEntries } from "../showcases";
import { BrandStep } from "./brand-step";
import {
  LaunchStep,
  optionalChannels,
  strategySocialChannels,
} from "./launch-step";
import { StepMarkers } from "./parts";
import { PlanStep } from "./plan-step";
import { SiteStep } from "./site-step";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Brain = NonNullable<CmoOverview["brandBrain"]>;

const noop = async () => {};
const site = (overview: CmoOverview, patch = {}) =>
  renderToStaticMarkup(
    <SiteStep
      overview={overview}
      messages={[]}
      finished={false}
      skipped={false}
      onAnswer={noop}
      onSkip={noop}
      onContinue={() => {}}
      onRetry={async () => null}
      onReply={noop}
      {...patch}
    />,
  );
const plan = (
  overview: CmoOverview,
  phase: "planning" | "writing-needed" | "review" = "review",
) =>
  renderToStaticMarkup(
    <PlanStep
      overview={overview}
      phase={phase}
      onRequest={async () => null}
      onSetAds={async () => null}
      onAnswer={noop}
      onUpdate={async () => null}
      onApprove={noop}
      onConnectMeasurement={async () => ({ url: null, error: null })}
    />,
  );
const questionsOn = (answers: ("yes" | "no" | undefined)[]) => {
  const base = draft();
  return {
    ...base,
    strategy: {
      ...(base.strategy as Strategy),
      changes: [],
      questions: answers.map((answer, index) => ({
        id: `q${index}`,
        question: `Do you sell ${index} things?`,
        statement: `They sell ${index} things.`,
        ...(answer ? { answer } : {}),
        ...(answer === "no" ? { note: "Many more" } : {}),
      })),
    },
  };
};

describe("pre-hire Site", () => {
  it("asks for the website with one primary button, and marks step 1", () => {
    const html = renderToStaticMarkup(
      <Onboarding
        websiteUrl="acme.io"
        onboard={async () => ({ attempt: 0, websiteUrl: "", errors: {} })}
      />,
    );
    expect(html).toContain(
      "Give me your website. I&#x27;ll bring back a plan.",
    );
    expect(html).toContain("Start reading");
    expect(html).toContain('value="acme.io"');
    expect(html).toContain("3 min");
    expect(html).toContain("Drafts your first month");
    expect(html).toMatch(/aria-current="step"[^>]*>(?:(?!<\/li>).)*Site/);
  });
});

describe("step markers", () => {
  it("marks the current step, the done ones and the ones to come", () => {
    const html = renderToStaticMarkup(<StepMarkers current={2} reached={2} />);
    const marker = (label: string) =>
      new RegExp(
        `<li class="ob-step (\\w+)"[^>]*>(?:(?!</li>).)*${label}`,
      ).exec(html)?.[1];
    expect(marker("Site")).toBe("done");
    expect(marker("Brand")).toBe("done");
    expect(marker("Plan")).toBe("now");
    expect(marker("Launch")).toBe("next");
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it("makes a done marker a button only when it leads somewhere", () => {
    const html = renderToStaticMarkup(
      <StepMarkers
        current={2}
        reached={3}
        open={(index) => (index === 1 ? () => {} : null)}
      />,
    );
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Brand/);
  });
});

describe("Site while Cuso reads", () => {
  it("shows the read live and says questions come when it lands", () => {
    const html = site(reading());
    expect(html).toContain("Reading acme.io.");
    expect(html).toContain("Cuso is reading");
    expect(html).toContain("Your website");
    expect(html).toContain("What I found so far");
    expect(html).toContain("7 of 16 sections");
    expect(html).toContain("questions come when the read lands");
    expect(html).not.toContain("Quick read");
    expect(html).not.toContain("See your brand");
  });

  it("asks the questions once the read lands, with Skip", () => {
    const html = site(asking({ work: work("research") }));
    expect(html).toContain("Answer a few while you wait");
    expect(html).toContain("Quick read");
    expect(html).toContain("1 of 2");
    expect(html).toContain("Do most customers find you through Google?");
    expect(html).toContain("Not sure");
    expect(html).toContain("Skip for now");
  });

  it("opens on the first question left", () => {
    const [first, ...rest] = brain.questions ?? [];
    const answered = {
      ...brain,
      questions: [{ ...first, answer: "yes" as const }, ...rest],
    } as Brain;
    const html = site(asking({ brandBrain: answered }));
    expect(html).toContain("2 of 2");
    expect(html).toContain("Is the 14-day trial your main offer?");
  });

  it("is done once everything is answered or skipped, and leads on", () => {
    const html = site(asking(), { finished: true, skipped: true });
    expect(html).toContain("That&#x27;s all I need.");
    expect(html).toContain("See your brand");
    expect(html).toContain("Change answers");
    expect(html).not.toContain("Quick read");
  });

  it("offers a retry when the read ended without a Brand Brain", () => {
    const html = site(reading({ work: work("research", { status: "done" }) }));
    expect(html).toContain("The read stopped.");
    expect(html).toContain("Try again");
  });

  it("says when credits ran out", () => {
    const html = site(
      reading({
        work: null,
        learning: "failed",
        billing: { plan: null, subscriptionStatus: null, availableCredits: 0 },
      }),
    );
    expect(html).toContain("out of credits");
    expect(html).toContain("Try again");
  });
});

describe("Brand", () => {
  const render = (
    overview: CmoOverview,
    ahead?: { label: string; onClick: () => void },
  ) =>
    renderToStaticMarkup(
      <BrandStep
        overview={overview}
        messages={[]}
        ahead={ahead}
        onCorrect={noop}
        onSave={noop}
        onAnswer={noop}
        onApprove={async () => null}
      />,
    );

  it("leads with the promise and one primary: Looks like us", () => {
    const html = render(draft({ brandBrainConfirmedAt: null, strategy: null }));
    expect(html).toContain("Here&#x27;s acme.io as I see it.");
    expect(html).toContain("tap any tile to see the source or fix it");
    expect(html).toContain("Your promise, in one line");
    expect(html).toContain("Looks like us");
    expect(html).toContain("Source: acme.io");
  });

  it("shows only the tiles that have data, in order", () => {
    const html = render(draft());
    const order = [
      "What you sell",
      "Who buys",
      "Your voice",
      "Competitors",
      "Profiles",
    ].map((label) => html.indexOf(`>${label}<`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // No marketing-today data, so no such tile.
    expect(html).not.toContain(">Marketing today<");
    expect(html).toContain("Rocket Pro");
  });

  it("counts unanswered questions", () => {
    expect(render(draft())).toContain("2 questions left");
    expect(
      render(draft({ brandBrain: { ...brain, questions: [] } })),
    ).not.toContain("questions left");
  });

  it("leads on to where the founder was when opened again", () => {
    const html = render(draft(), { label: "Plan", onClick: () => {} });
    expect(html).toContain("Continue to Plan");
    expect(html).not.toContain("Looks like us");
  });
});

describe("Plan", () => {
  it("waits on the planning screen while Cuso writes the plan", () => {
    const html = plan(
      draft({ strategy: null, work: work("strategy") }),
      "planning",
    );
    expect(html).toContain("Writing your plan");
    expect(html).toContain("Your channels");
    expect(html).not.toContain("Approve plan");
  });

  it("offers to try again when planning stopped", () => {
    const html = plan(
      draft({ strategy: null, work: work("strategy", { status: "failed" }) }),
      "planning",
    );
    expect(html).toContain("Planning stopped");
    expect(html).toContain("Try again");
  });

  it("asks for the plan when Brand is confirmed and nothing writes it", () => {
    const html = plan(draft({ strategy: null }), "writing-needed");
    expect(html).toContain("Write my plan");
  });

  it("shows the goal, the plan and Approve plan as the primary", () => {
    const html = plan(draft());
    expect(html).toContain("The goal");
    expect(html).toContain("More demo requests");
    expect(html).toContain("Approve plan");
    expect(html).toContain("Ask for a change");
    expect(html).toContain("X now once a week");
    for (const tab of ["The plan", "Your month", "How we know it works"]) {
      expect(html).toContain(tab);
    }
    expect(html).toContain('role="tablist"');
  });

  it("tells a viewer who cannot approve who does, and hides Approve", () => {
    const html = plan(draft({ viewerCanApprove: false }));
    expect(html).not.toContain("Approve plan");
    expect(html).toContain("An owner or admin approves the plan.");
  });

  it("asks the plan's questions as chips with Yes and No", () => {
    const html = plan(questionsOn([undefined, "yes"]));
    expect(html).toContain("Check these");
    expect(html).toContain("Do you sell 0 things?");
    expect(html).toContain("Do you sell 1 things?");
    expect(html.match(/>Yes</g)).toHaveLength(2);
    expect(html.match(/>No</g)).toHaveLength(2);
    expect(html).toContain("Approve plan");
  });

  it("updates the plan instead of approving while a no is not fitted", () => {
    const html = plan(questionsOn(["yes", "no"]));
    expect(html).toContain("Update plan");
    expect(html).not.toContain("Approve plan");
    expect(html).toContain("Many more");
  });

  it("asks about pace and the ad budget in the same strip", () => {
    const base = draft();
    const html = plan({
      ...base,
      strategy: {
        ...strategy,
        pace: { level: "active", why: "One a day", perWeek: 7 },
        ads: {
          monthly: 200,
          currency: "EUR",
          expect: "Some sales",
          without: "Organic only",
        },
      },
    });
    expect(html).toContain("Active");
    expect(html).toContain("Is €200 a month OK for ads?");
  });
});

describe("Launch", () => {
  const approved = (patch: Partial<CmoOverview> = {}) =>
    draft({
      ...cmoStrategyVersion(new Date()),
      onboardingStep: "accounts",
      strategy: {
        ...strategy,
        channels: [
          ...strategy.channels,
          { channel: "meta_ads", cadence: "2 a month" },
        ],
        calendar: [
          ...strategy.calendar,
          {
            id: "meta-1",
            date: "2026-10-09",
            channel: "meta_ads",
            format: "image",
            title: "Try it free",
            status: "idea" as const,
          },
        ],
        proposals: [
          { channel: "google_ads", why: "Search", what: "Ads", perMonth: 4 },
          { channel: "instagram", why: "Feed", what: "Posts", perMonth: 4 },
        ],
      },
      ...patch,
    });
  const render = (value: CmoOverview) =>
    renderToStaticMarkup(
      <LaunchStep
        overview={value}
        onConnect={async () => ({ url: null, error: null })}
        onConnectAds={async () => ({ url: null, error: null })}
        onContinue={noop}
      />,
    );
  const launchOff = (html: string) =>
    /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Launch Cuso/.test(html);
  const active = (provider: string) => ({
    id: provider,
    provider,
    handle: "acme",
    displayName: "Acme",
    status: "ACTIVE",
  });

  it("offers to connect only the social networks in the plan", () => {
    expect(strategySocialChannels(draft())).toEqual(["linkedin", "x"]);
  });

  it("shows the plan's own ads as optional too", () => {
    const ad = {
      id: "ad-1",
      date: "2026-10-05",
      channel: "meta_ads",
      format: "ad",
      title: "Launch ad",
      status: "idea" as const,
    };
    const ads = feedScreens([ad]).find((screen) => screen.key === "ads");
    expect(ads).toMatchObject({
      optional: true,
      perMonth: 1,
      name: "Meta ads",
    });
  });

  it("makes ads and proposed channels optional, and leaves the newsletter out", () => {
    expect(optionalChannels(approved()).map((channel) => channel.key)).toEqual([
      "meta_ads",
      "google_ads",
      "instagram",
    ]);
  });

  it("lists only the plan's networks, with their pieces, and no newsletter", () => {
    const html = render(approved());
    expect(html).toContain("One thing, then I start.");
    expect(html).toContain("LinkedIn");
    expect(html).toContain("1 of 4 pieces go here");
    // Either network unlocks Launch, so neither row claims to be needed.
    expect(html).not.toContain("Needed to start");
    expect(html).toContain("Can wait");
    expect(html).toContain("Add later");
    expect(html).not.toContain("Newsletter");
    expect(html).not.toContain("mailing list");
  });

  it("launches once one of the plan's networks is connected", () => {
    const before = render(approved());
    expect(before).toContain("Connect LinkedIn or X to launch.");
    expect(launchOff(before)).toBe(true);

    const after = render(approved({ channels: [active("x")] }));
    expect(after).not.toContain("to launch.");
    expect(after).toContain("Nothing posts until you approve it.");
    expect(after).toContain("@acme");
    expect(launchOff(after)).toBe(false);
  });

  it("marks the one network that unlocks Launch as needed", () => {
    const only = approved();
    const html = render({
      ...only,
      strategy: {
        ...(only.strategy as Strategy),
        channels: [{ channel: "linkedin", cadence: "2 a week" }],
      },
    });
    expect(html).toContain("Needed to start");
  });

  it("shows no celebration before Launch is pressed", () => {
    const html = render(approved({ channels: [active("x")] }));
    expect(html).not.toContain("is on it.");
    expect(html).not.toContain("Go to Today");
  });
});

describe("strategy helpers the screens build on", () => {
  it("lays four Monday-first weeks out from the first entry", () => {
    const weeks = planWeeks(strategy.calendar);
    expect(weeks).toHaveLength(4);
    expect(weeks[0]?.days[0]).toBe("2026-10-05");
    expect(weeks[3]?.days[6]).toBe("2026-11-01");
  });

  it("groups pieces into account previews, written drafts first", () => {
    const groups = showcaseEntries(strategy);
    expect(groups.get("linkedin")?.map((entry) => entry.id)).toEqual(["a"]);
    expect(groups.get("x")?.map((entry) => entry.id)).toEqual(["b"]);
    expect(groups.get("newsletter")?.map((entry) => entry.id)).toEqual(["c"]);
  });
});
