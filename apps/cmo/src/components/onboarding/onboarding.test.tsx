import type { CmoOverview } from "@sokosumi/core-client";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { planWeeks } from "../../lib/calendar";
import { cmoBilling, cmoStrategyVersion } from "../../test-fixtures/cmo";
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
import { BrandStep, fixWaitNote } from "./brand-step";
import {
  LaunchStep,
  optionalChannels,
  strategySocialChannels,
} from "./launch-step";
import { PlanStep, planTabAfterKey } from "./plan-step";
import { SiteStep } from "./site-step";
import { onboardingStep, type SitePhase } from "./step";
import { StepMarkers } from "./step-markers";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Brain = NonNullable<CmoOverview["brandBrain"]>;

const noop = async () => {};
const site = (
  overview: CmoOverview,
  patch: Partial<ComponentProps<typeof SiteStep>> = {},
) =>
  renderToStaticMarkup(
    <SiteStep
      overview={overview}
      messages={[]}
      phase={
        onboardingStep(overview).step === "site"
          ? (onboardingStep(overview).phase as SitePhase)
          : "asking"
      }
      next="brand"
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
      "Give me your website. I&#x27;ll show you a month of posts.",
    );
    expect(html).toContain("Start reading");
    expect(html).toContain('value="acme.io"');
    expect(html).not.toContain("3 min");
    expect(html).toContain("Drafts your first month");
    expect(html).toMatch(/aria-current="step"[^>]*>(?:(?!<\/li>).)*Research/);
    // No organizations: nothing asks where Cuso goes.
    expect(html).not.toContain('name="organizationId"');
  });

  it("marks a test copy and leaves out where he goes: Core puts him beside his source", () => {
    const html = renderToStaticMarkup(
      <Onboarding
        organizations={[{ id: "org-1", name: "Agency" }]}
        testCopyOf="project-source"
        onboard={async () => ({ attempt: 0, websiteUrl: "", errors: {} })}
      />,
    );
    expect(html).toContain('name="testCopyOf" value="project-source"');
    expect(html).toContain("Test copy.");
    expect(html).not.toContain('name="organizationId"');
  });

  it("asks where Cuso goes, with a new organization selected", () => {
    const html = renderToStaticMarkup(
      <Onboarding
        organizations={[
          { id: "org-1", name: "Agency" },
          { id: "org-2", name: "Studio" },
        ]}
        onboard={async () => ({ attempt: 0, websiteUrl: "", errors: {} })}
      />,
    );
    const options = [
      ...html.matchAll(/<input[^>]*name="organizationId"[^>]*>/g),
    ].map(([tag]) => [/value="([^"]*)"/.exec(tag)?.[1], /checked/.test(tag)]);
    expect(options).toEqual([
      ["", true],
      ["org-1", false],
      ["org-2", false],
    ]);
    expect(html).toContain("New organization (named after your website)");
    expect(html).toContain("Agency");
  });
});

describe("step markers", () => {
  it("marks the current step, the done ones and the ones to come", () => {
    const html = renderToStaticMarkup(<StepMarkers current={2} reached={2} />);
    const marker = (label: string) =>
      new RegExp(
        `<li class="ob-step (\\w+)"[^>]*>(?:(?!</li>).)*${label}`,
      ).exec(html)?.[1];
    expect(marker("Research")).toBe("done");
    expect(marker("Brand")).toBe("done");
    expect(marker("Strategy")).toBe("now");
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
  it("shows his steps, never his raw thinking", () => {
    const html = site({
      ...reading(),
      activity: {
        step: "Comparing competitors",
        reasoning: "It seems like I might not need to do competitor research.",
      },
    });
    expect(html).toContain("Reading your site");
    expect(html).not.toContain("It seems like");
    expect(html).not.toContain("working-why");
  });

  it("shows the read live and says questions come when it lands", () => {
    const html = site(reading());
    expect(html).toContain("Reading acme.io.");
    expect(html).toContain("Cuso is reading");
    expect(html).toContain("Reading your site");
    expect(html).toContain("Cuso is reading · ");
    expect(html).toContain(" so far");
    expect(html).toContain("/cuso/researching.svg");
    // The wait shows: what he is doing now, and the running bar.
    expect(html).toContain("ob-scene-now");
    expect(html).toContain("ob-scene-bar");
    expect(html).toContain("What I found so far");
    expect(html).toContain("7 of 16 sections");
    expect(html).toContain("questions come when the read lands");
    expect(html).not.toContain("Quick read");
    expect(html).not.toContain("See your brand");
  });

  it("shows what was found once the Brand Brain exists, not skeletons", () => {
    const html = site(asking({ work: work("research") }));
    expect(html).toContain("What I found so far");
    expect(html).toContain("What you sell");
    expect(html).toContain("Source: acme.io");
    expect(html).not.toContain("ob-skeleton");
    expect(site(reading())).toContain("ob-skeleton");
  });

  it("shows the latest sections Cuso saved, with skeletons for the rest", () => {
    const html = site(
      reading({ work: work("research", { sectionsSaved: 3 }) }),
    );
    expect(html).toContain("Company basics");
    expect(html).toContain("Rockets for founders, since 2019");
    expect(html).toContain("Launches take months, not days");
    expect(html).toContain("ob-skeleton");
  });

  it("says what happens once every section is in, before the Brand Brain lands", () => {
    const html = site(
      reading({ work: work("research", { sectionsSaved: 16 }) }),
    );
    expect(html).toContain("16 of 16 sections");
    expect(html).toContain("All 16 sections are in.");
    expect(html).toContain("Now I&#x27;m putting your 16 sections together");
    expect(html).not.toContain("ob-skeleton");
    expect(html).not.toContain("questions come when the read lands");
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
        billing: cmoBilling({ availableCredits: 0 }),
      }),
    );
    expect(html).toContain("out of credits");
    expect(html).toContain("Try again");
    // Hiring is before the subscription: no top-up without one.
    expect(html).not.toContain("Top up");
  });

  it("offers the top-up when credits ran out for a Cuso who may have one", () => {
    const html = site(
      reading({
        work: null,
        learning: "failed",
        billing: cmoBilling({ availableCredits: 0 }),
      }),
      { topUp: async () => ({ url: null, error: null }) },
    );
    expect(html).toContain("out of credits");
    expect(html).toContain(">Top up</button>");
  });
});

describe("a Cuso with Tester credits who ran out before his plan", () => {
  const ranOut = reading({
    work: null,
    learning: "failed",
    subscriptionActive: false,
    billing: cmoBilling({
      availableCredits: 0,
      status: null,
      hasTesterCredits: true,
    }),
  });
  const subscribe = async () => ({ url: null, error: null });

  it("offers the plan checkout on the read, not a top-up", () => {
    const html = site(ranOut, { subscribe });
    expect(html).toContain("out of credits");
    expect(html).toContain(">Subscribe</button>");
    expect(html).not.toMatch(/top up/i);
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
    expect(html).toContain("Tap any line to see the source or fix it.");
    expect(html).toContain("Your promise, in one line");
    expect(html).toContain("Looks like us");
    expect(html).toContain("Source: acme.io");
  });

  it("drops the site as the promise's source once the owner rewrote it", () => {
    const promise = (html: string) =>
      html.slice(html.indexOf("ob-promise"), html.indexOf("ob-tiles"));
    expect(promise(render(draft()))).toContain("Source: acme.io");
    const html = promise(
      render(draft({ brandBrain: { ...brain, promiseByOwner: true } })),
    );
    expect(html).toContain("Your promise, in one line");
    expect(html).not.toContain("Source:");
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

  it("shows who buys as the owner corrected it", () => {
    const html = render(
      draft({
        brandBrain: {
          ...brain,
          reveal: {
            positioning: "Rockets for founders",
            insights: [],
            buyers: [{ role: "Home brewer", wants: "Fresh beans", worry: "" }],
          },
          profile: {
            customers: {
              headline: "Cafe regulars come first",
              answer:
                "Most customers are cafe regulars; home brewers come second.",
              findings: [],
              openQuestions: [],
              fix: { note: "Regulars first", at: "2026-11-20", fixed: true },
            },
          },
        },
      }),
    );
    expect(html).toContain("Cafe regulars come first");
    expect(html).not.toContain("Home brewer<");
    expect(html).not.toContain("Wants: Fresh beans");
  });

  it("shows what they sell as the owner corrected it", () => {
    const html = render(
      draft({
        brandBrain: {
          ...brain,
          profile: {
            offer: {
              headline: "Rocket rentals by the day",
              answer: "Acme rents rockets by the day; it sells none.",
              findings: [],
              openQuestions: [],
              fix: { note: "We rent", at: "2026-11-20", fixed: true },
            },
          },
        },
      }),
    );
    expect(html).toContain("Rocket rentals by the day");
    expect(html).toContain("Acme rents rockets by the day; it sells none.");
  });

  it("keeps tile values short and puts the long text in the detail", () => {
    const html = render(
      draft({
        brandBrain: {
          ...brain,
          products: [],
          offers: [
            { name: "Free", what: "Everything for one site", price: "$0" },
            { name: "Team", what: "More seats", price: "$99" },
          ],
          competitors: [{ name: "Whaaat AI" }, { name: "Moonshot" }],
          marketingToday: {
            summary:
              "The site features product, use-case, pricing, and comparison pages; the blog is quiet.",
            channels: [
              { name: "x", basis: "estimated" },
              { name: "LinkedIn", basis: "measured" },
            ],
          },
        },
      }),
    );
    expect(html).toContain(">2 offers<");
    expect(html).toContain(">2 compared<");
    expect(html).toContain("Whaaat AI, Moonshot");
    expect(html).toContain(">X and LinkedIn<");
    expect(html).toContain("The site features product, use-case, pricing");
  });

  it("shows the site with its logo and colours when media exists", () => {
    const shot = { url: "/home.jpg", fileId: null, pageUrl: "https://acme.io" };
    const html = render(
      draft({
        brandMedia: {
          capturedAt: "2026-10-05T09:02:00Z",
          pages: [
            { ...shot, label: "Home", device: "desktop", fullUrl: null },
            { ...shot, label: "Home", device: "mobile", fullUrl: null },
            {
              ...shot,
              url: "/pricing.jpg",
              label: "Pricing",
              pageUrl: "https://acme.io/plans",
              device: "desktop",
              fullUrl: null,
            },
          ],
          sections: [
            {
              ...shot,
              url: "/plans.jpg",
              kind: "pricing",
              title: "Plans for every launch",
              pageLabel: "Pricing",
            },
          ],
          competitors: [],
          pictures: [],
          logos: {
            logo: { url: "/logo.png", fileId: null },
            dark: null,
            mark: { url: "/mark.png", fileId: null },
          },
        },
        brandVisual: {
          logoUrl: null,
          colors: ["a", "b", "c", "d", "e", "f"].map((d) => `#${d.repeat(6)}`),
          fonts: [],
          siteName: "Acme",
          designMdUrl: null,
          images: [],
        },
      }),
    );
    expect(html).toContain("Your site");
    expect(html).toContain("acme.io homepage");
    expect(html).toContain("acme.io on a phone");
    // The pages Cuso read and what he cut from them, under one fold.
    expect(html).toContain("What I found on your site");
    expect(html).toContain('alt="Your logo"');
    expect(html).toContain('alt="Your mark"');
    expect(html).not.toContain("on a dark background");
    expect(html).toContain('href="https://acme.io/plans"');
    expect(html).toContain(
      "Pricing on the Pricing page: Plans for every launch",
    );
    // The colours show once, in "Your look", not again under the site.
    expect(html).not.toContain("ob-swatches");
    const site = html.slice(html.indexOf(">Your site<"));
    // The site card ends where the next card starts.
    expect(site.slice(0, site.indexOf('class="card'))).not.toContain("#aaaaaa");
    expect(html).toContain("#aaaaaa");
    expect(render(draft())).not.toContain("Your site");
  });

  it("leaves out a voice Cuso could not read, and names the font as a font", () => {
    const html = render(
      draft({
        brandBrain: { ...brain, voice: { ...brain.voice, tone: "Unknown." } },
        brandVisual: {
          logoUrl: null,
          colors: [],
          fonts: ["Auto Pro"],
          siteName: "Acme",
          designMdUrl: null,
          images: [],
        },
      }),
    );
    expect(html).not.toContain(">Your voice<");
    expect(html).not.toContain("Unknown.");
    expect(html.replace(/<[^>]+>/g, "")).toContain("Font: Auto Pro");
    // The name stands in its own face where the device has it.
    expect(html).toContain(
      "font-family:&quot;Auto Pro&quot;, var(--font-sans)",
    );
  });

  it("shows the brand's colours as swatches in the look row, never as hex codes", () => {
    const html = render(
      draft({
        brandVisual: {
          logoUrl: null,
          colors: ["#ff51ff", "#0c0c0c"],
          fonts: [],
          siteName: "Acme",
          designMdUrl: null,
          images: [],
        },
      }),
    );
    const row = html.slice(html.indexOf(">Your look<"));
    const detail = row.slice(0, row.indexOf("</button>"));
    expect(detail).toContain('class="ob-look-dots"');
    expect(detail).toContain("background:#ff51ff");
    expect(detail.replace(/<[^>]+>/g, "")).not.toContain("#ff51ff");
  });

  it("counts an account the owner connected as a profile, and says when the site links to none", () => {
    const onlySite = {
      ...brain,
      channels: [{ name: "Website", url: "https://acme.io" }],
    };
    const none = render(draft({ brandBrain: onlySite, channels: [] }));
    expect(none).toContain("1 profile");
    expect(none).toContain("No social profile is linked on your site.");
    const connected = render(
      draft({
        brandBrain: onlySite,
        channels: [
          {
            id: "c1",
            provider: "x",
            handle: "@acme",
            displayName: "Acme",
            status: "ACTIVE",
            personalProfile: false,
          },
        ],
      }),
    );
    expect(connected).toContain("2 profiles");
    expect(connected).toContain("Website, X");
    expect(connected).not.toContain("No social profile is linked");
  });

  it("counts unanswered questions", () => {
    expect(render(draft())).toContain("2 questions left");
    expect(
      render(draft({ brandBrain: { ...brain, questions: [] } })),
    ).not.toContain("questions left");
  });

  it("leads on to where the founder was when opened again", () => {
    const html = render(draft(), { label: "Strategy", onClick: () => {} });
    expect(html).toContain("Continue to Strategy");
    expect(html).not.toContain("Looks like us");
  });
});

describe("Plan", () => {
  it("waits on the planning screen while Cuso writes the plan", () => {
    const html = plan(
      draft({ strategy: null, work: work("strategy") }),
      "planning",
    );
    expect(html).toContain("Writing your strategy");
    expect(html).toContain("This takes a few minutes.");
    expect(html).toContain(" so far");
    expect(html).toContain("Your channels");
    expect(html).toContain("Choosing your idea, channels and pillars");
    expect(html).not.toContain("Approve strategy");
  });

  it("shows his steps while he plans, never his raw thinking", () => {
    const html = plan(
      draft({
        strategy: null,
        work: work("strategy"),
        activity: {
          step: "Planning",
          reasoning: "I'm thinking about the save_strategy part patch.",
        },
      }),
      "planning",
    );
    expect(html).toContain("Your channels");
    expect(html).not.toContain("save_strategy");
    expect(html).not.toContain("working-why");
  });

  it("shows the plan in the feed as Cuso saves it", () => {
    const before = plan(
      draft({ strategy: null, work: work("strategy") }),
      "planning",
    );
    expect(before).toContain("Choosing your idea, channels and pillars");
    expect(before).not.toContain("Getting started");

    const after = plan(
      draft({
        work: work("strategy"),
        strategy: { ...strategy, calendar: [] },
      }),
      "planning",
    );
    expect(after).toContain("Show the rockets working.");
    expect(after).toContain("LinkedIn, 2 a week");
    expect(after).toContain("Topic: Product stories");
    expect(after).toContain("Writing four weeks, day by day");
    expect(after.match(/Writing your strategy/g)).toHaveLength(1);
  });

  it("offers to try again when planning stopped", () => {
    const html = plan(
      draft({ strategy: null, work: work("strategy", { status: "failed" }) }),
      "planning",
    );
    expect(html).toContain("Writing stopped");
    expect(html).toContain("Try again");
  });

  it("makes the short goal the one H1, without the long sentence", () => {
    const sentence =
      "We'll reach marketing leads with recurring backlogs, show named specialists turning briefs into finished files, and invite them to try the Free plan.";
    const base = draft();
    const html = plan({
      ...base,
      strategy: {
        ...strategy,
        objective: { outcome: "More marketing teams starting Free" },
        idea: {
          who: "Leads",
          position: "Specialists",
          attract: "Demos",
          offer: "Free",
          sentence,
        },
      },
    });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(
      /<h1 class="ob-goal-headline">More marketing teams starting Free<\/h1>/,
    );
    // The sentence repeated the goal, Who and The offer (owner, 2026-11-23).
    expect(html).not.toContain("ob-goal-statement");
  });

  it("shows what stops people buying, the other plans and the rest closed", () => {
    const base = draft();
    const html = plan({
      ...base,
      strategy: {
        ...strategy,
        barrier: { kind: "trust", text: "Teams fear vendors that go quiet." },
        alternatives: [
          { sentence: "Lead with price.", why: "Fast, but fickle." },
        ],
        ladder: { core: { what: "Rocket Pro" } },
        why: "Founders read LinkedIn.",
      },
    });
    expect(html).toContain("What stops people buying");
    expect(html).toContain("Teams fear vendors that go quiet.");
    expect(html).toContain("I also looked at 1 other strategy.");
    expect(html).toContain("Compare them");
    expect(html).not.toContain("Lead with price.");
    expect(html).toMatch(/<details class="ob-more">/);
    expect(html).toContain("Everything in the strategy");
    expect(html).toContain("Why this strategy");
  });

  it("is read-only once approved, except the owner's Yes or No to ads", () => {
    const base = draft(cmoStrategyVersion(new Date()));
    const html = renderToStaticMarkup(
      <PlanStep
        overview={{
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
            questions: [
              {
                id: "q",
                question: "Do you ship every month?",
                statement: "They ship.",
                answer: "no",
                note: "Every quarter",
              },
            ],
          },
        }}
        phase="review"
        ahead={{ label: "Launch", onClick: () => {} }}
        onRequest={async () => null}
        onSetAds={async () => null}
        onAnswer={noop}
        onUpdate={async () => null}
        onApprove={noop}
      />,
    );
    expect(html).toContain("Continue to Launch");
    expect(html).toContain("Do you ship every month?");
    expect(html).toContain("Every quarter");
    expect(html).not.toContain("Pace:");
    expect(html).not.toContain("two a day on each network");
    // Ads cost the owner money, so they stay theirs to change (NMKR, 2026-11-24).
    expect(html).toContain("€200 a month. Some sales");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Yes</);
    expect(html).toContain("They start once you approve it.");
    for (const live of [
      "Ask for a change",
      "Approve strategy",
      "Update strategy",
      ">All-in<",
      ">Change<",
    ]) {
      expect(html).not.toContain(live);
    }
    // Before the first plan the owner can still start over (NMKR, 2026-11-23).
    // What starting over cancels is said in its confirm step, not on the page.
    expect(html).toContain("Write a new strategy");
    expect(html).not.toContain(
      "then its posts that have not gone out are canceled",
    );
  });

  it("asks for the plan when Brand is confirmed and nothing writes it", () => {
    const html = plan(draft({ strategy: null }), "writing-needed");
    expect(html).toContain("Write my strategy");
  });

  it("shows the goal, the plan and Approve plan as the primary", () => {
    const html = plan(draft());
    expect(html).toContain("The goal");
    expect(html).toContain("More demo requests");
    expect(html).toContain("Approve strategy");
    expect(html).toContain("Ask for a change");
    expect(html).toContain("X now once a week");
    for (const tab of ["Your funnel", "Your month", "How we know it works"]) {
      expect(html).toContain(tab);
    }
    expect(html).toContain('role="tablist"');
  });

  it("tells a viewer who cannot approve who does, and hides Approve", () => {
    const html = plan(draft({ viewerCanApprove: false }));
    expect(html).not.toContain("Approve strategy");
    expect(html).toContain("An owner or admin approves the strategy.");
  });

  it("asks the plan's questions as chips with Yes and No", () => {
    const html = plan(questionsOn([undefined, "yes"]));
    expect(html).toContain("Did I get these right?");
    expect(html).toContain("Do you sell 0 things?");
    expect(html).toContain("Do you sell 1 things?");
    expect(html.match(/>Yes</g)).toHaveLength(2);
    expect(html.match(/>No</g)).toHaveLength(2);
    expect(html.match(/>Not sure</g)).toHaveLength(2);
    expect(html).toContain("Approve strategy");
  });

  it("updates the plan instead of approving while a no is not fitted", () => {
    const html = plan(questionsOn(["yes", "no"]));
    expect(html).toContain("Update strategy");
    expect(html).not.toContain("Approve strategy");
    // Said beside the checks, where the owner just answered.
    expect(html).toContain("still shows your old answer");
    expect(plan(questionsOn(["yes", "yes"]))).not.toContain(
      "still shows your old answer",
    );
    expect(html).toContain("Many more");
  });

  it("asks about the ad budget in the checks strip, with no pace", () => {
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
    expect(html).toContain("Do you want ads?");
    expect(html).toContain("Ads are extra to your plan");
    // The strategy has ads: Yes is picked and the amount can be changed.
    expect(html).toMatch(/aria-pressed="true"[^>]*>Yes</);
    expect(html).toContain('value="200"');
    expect(html).not.toContain("OK for ads");
  });

  it("asks Yes or No to ads with Cuso's suggestion in words, the budget field only after a Yes", () => {
    const html = plan({
      ...draft(),
      strategy: {
        ...strategy,
        ads: {
          monthly: 0,
          currency: "CHF",
          expect: "20 to 40 clicks a month",
          without: "Posts and search bring the calls.",
          suggest: { channel: "google_ads", monthly: 600 },
        },
      },
    });
    expect(html).toContain("Do you want ads?");
    expect(html.replace(/<!-- -->/g, "")).toMatch(
      /Cuso suggests CHF\s600 a month on Google Ads\. 20 to 40 clicks a month/,
    );
    // Unanswered: neither is picked, and the budget field waits for a Yes.
    expect(html).toContain(
      '<button type="button" aria-pressed="false">Yes</button><button type="button" aria-pressed="false">No</button>',
    );
    expect(html).not.toContain("Monthly ad budget");
    // Ad blockers hide elements labelled "Ads" or classed "*-ads" (Brave, 2026-11-24).
    expect(html).not.toMatch(/aria-label="Ads"|class="[^"]*-ads\b/);
  });

  it("shows the owner's No to ads as picked", () => {
    const html = plan({
      ...draft(),
      strategy: {
        ...strategy,
        ads: {
          monthly: 0,
          currency: "CHF",
          expect: "20 to 40 clicks a month",
          without: "Posts and search bring the calls.",
          suggest: { channel: "google_ads", monthly: 600 },
          setByOwner: true,
        },
      },
    });
    expect(html).toMatch(/aria-pressed="true"[^>]*>No</);
    expect(html).toContain("No ads. Posts and search bring the calls.");
    expect(html).not.toContain("Cuso suggests");
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
        onSetPresenter={async () => ({ error: null })}
        onClearPresenter={async () => ({ error: null })}
        onGoToday={() => {}}
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
    personalProfile: false,
  });

  it("offers to connect only the social networks in the plan", () => {
    expect(strategySocialChannels(draft())).toEqual(["linkedin", "x"]);
  });

  it("shows the month's own ads as planned, never as an optional extra", () => {
    const ad = {
      id: "ad-1",
      date: "2026-10-05",
      channel: "meta_ads",
      format: "ad",
      title: "Launch ad",
      status: "idea" as const,
    };
    const ads = feedScreens([ad]).find((screen) => screen.key === "ads");
    expect(ads).toMatchObject({ name: "Meta ads", ads: "meta_ads" });
    expect(ads?.optional).toBeUndefined();
  });

  it("offers every channel CMO can connect beyond the plan's networks, and leaves the newsletter out", () => {
    // The plan's ads and Cuso's proposals first, then every other network.
    expect(optionalChannels(approved()).map((channel) => channel.key)).toEqual([
      "meta_ads",
      "google_ads",
      "instagram",
      "facebook",
      "youtube",
    ]);
    const html = render(approved());
    for (const name of ["Facebook", "YouTube", "Google Ads"])
      expect(html).toMatch(new RegExp(`button-small[^>]*>${name}[,<]`));
    expect(html).not.toContain("TikTok");
  });

  it("offers TikTok where Core lets this Project connect it", () => {
    expect(
      optionalChannels(approved({ tiktokEnabled: true })).map(
        (channel) => channel.key,
      ),
    ).toContain("tiktok");
  });

  it("offers the places Cuso reads the numbers from, until each is connected", () => {
    const source = (
      provider: CmoOverview["measurement"][number]["provider"],
      name: string,
      status: CmoOverview["measurement"][number]["status"],
    ) => ({ provider, name, measures: "Visits", status });
    const overview = approved({
      measurement: [
        source("google_analytics", "Google Analytics", "none"),
        source("google_search_console", "Search Console", "connected"),
      ] as CmoOverview["measurement"],
    });
    const html = renderToStaticMarkup(
      <LaunchStep
        overview={overview}
        onConnect={async () => ({ url: null, error: null })}
        onConnectAds={async () => ({ url: null, error: null })}
        onConnectMeasurement={async () => ({ url: null, error: null })}
        onSetPresenter={async () => ({ error: null })}
        onClearPresenter={async () => ({ error: null })}
        onGoToday={() => {}}
      />,
    );
    expect(html).toContain(">Google Analytics</button>");
    expect(html).not.toContain(">Search Console</button>");
  });

  it("lists only the plan's networks, with their pieces, and no newsletter", () => {
    const html = render(approved());
    expect(html).toContain("One thing, then I start.");
    expect(html).toContain("LinkedIn");
    expect(html).toContain("1 of 4 posts go here");
    // Either network unlocks Launch, so neither row claims to be needed.
    expect(html).not.toContain("Needed to start");
    // The chips say what each would add.
    expect(html).toContain("Google Ads, +4 ads");
    expect(html).toContain("Instagram, +4 posts");
    expect(html).toContain("Facebook &amp; Instagram ads, +1 ad");
    // Ads are an add-later chip, not a row.
    expect(html).not.toContain("Can wait");
    expect(html).toContain("Add later");
    expect(html).toContain("Facebook &amp; Instagram ads");
    expect(html).not.toContain("Newsletter");
    expect(html).not.toContain("mailing list");
  });

  it("launches once one of the plan's networks is connected", () => {
    const before = render(approved());
    expect(before).toContain("Connect LinkedIn or X to launch.");
    expect(launchOff(before)).toBe(true);

    const after = render(approved({ channels: [active("x")] }));
    expect(after).not.toContain("to launch.");
    expect(after).toContain("only does what your approved strategy says");
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

  it("with only ads in the plan, is ready at once and keeps ads under Add later", () => {
    const base = approved();
    const html = render({
      ...base,
      strategy: {
        ...(base.strategy as Strategy),
        channels: [{ channel: "meta_ads", cadence: "2 a month" }],
        calendar: [
          {
            id: "meta-1",
            date: "2026-10-09",
            channel: "meta_ads",
            format: "image",
            title: "Try it free",
            status: "idea" as const,
          },
        ],
        proposals: [],
      },
    });
    expect(html).toContain("Ready when you are.");
    expect(html).not.toContain("Connect where I post.");
    expect(html).toContain("Add later");
    expect(html).toContain("Facebook &amp; Instagram ads");
    expect(launchOff(html)).toBe(false);
  });

  it("shows no celebration before Launch is pressed", () => {
    const html = render(approved({ channels: [active("x")] }));
    expect(html).not.toContain("is on it.");
    expect(html).not.toContain("Go to Today");
  });
});

describe("plan tab keyboard", () => {
  it("moves left and right around the three tabs, and jumps to the ends", () => {
    expect(planTabAfterKey({ key: "ArrowRight" }, 0)).toBe(1);
    expect(planTabAfterKey({ key: "ArrowRight" }, 2)).toBe(0);
    expect(planTabAfterKey({ key: "ArrowLeft" }, 0)).toBe(2);
    expect(planTabAfterKey({ key: "Home" }, 2)).toBe(0);
    expect(planTabAfterKey({ key: "End" }, 0)).toBe(2);
    expect(planTabAfterKey({ key: "Enter" }, 0)).toBeNull();
  });
});

describe("strategy helpers the screens build on", () => {
  it("lays four Monday-first weeks out from the first entry", () => {
    const weeks = planWeeks(strategy.calendar);
    expect(weeks).toHaveLength(4);
    expect(weeks[0]?.days[0]).toBe("2026-10-05");
    expect(weeks[3]?.days[6]).toBe("2026-11-01");
  });
});

describe("how long a correction waits", () => {
  it("says the strategy comes first, and how long, while Cuso writes it", () => {
    expect(
      fixWaitNote(
        draft({
          botStatus: "RUNNING",
          work: work("strategy", { change: null }),
        }),
      ),
    ).toBe(
      "Cuso is writing your strategy now. He makes this fix as soon as he is done, usually within 15 minutes, and updates the strategy to match.",
    );
  });

  it("promises a quick fix otherwise", () => {
    expect(fixWaitNote(draft({ work: null }))).toBe(
      "Cuso will fix this and update your strategy.",
    );
    expect(
      fixWaitNote(
        draft({
          botStatus: "RUNNING",
          work: work("strategy", { change: "patch" }),
        }),
      ),
    ).toBe("Cuso will fix this and update your strategy.");
  });
});
