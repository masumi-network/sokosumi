import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { planWeeks } from "../../lib/calendar";
import { cmoStrategyVersion } from "../../test-fixtures/cmo";
import { showcaseEntries } from "../showcases";
import { CheckStep } from "./check-step";
import { strategySocialChannels } from "./connect-step";
import { onboardingStep } from "./flow";
import { PricingStep } from "./pricing-step";
import { QuestionsStep } from "./questions-step";
import { ResearchStep } from "./research-step";
import { ResultsStep } from "./results-step";
import { StrategyStep } from "./strategy-step";

type Strategy = NonNullable<CmoOverview["strategy"]>;

const brain: NonNullable<CmoOverview["brandBrain"]> = {
  summary: "Acme sells rockets.",
  voice: { tone: "Direct", do: [], dont: [], examples: [] },
  audience: ["Founders"],
  products: ["Rockets"],
  competitors: [],
  channels: [],
};

const strategy: Strategy = {
  month: "2026-10",
  summary: "Show the rockets working.",
  why: "Founders read LinkedIn.",
  goals: ["More demo requests"],
  pillars: ["Launch stories"],
  channels: [
    { channel: "linkedin", cadence: "2 a week", why: "Where founders are" },
    { channel: "x", cadence: "1 a week" },
    { channel: "newsletter", cadence: "1 a month" },
  ],
  calendar: [
    {
      id: "a",
      date: "2026-10-06",
      time: "09:00",
      channel: "linkedin",
      title: "Why we built it",
      format: "post",
      status: "idea",
      hook: "We built a rocket in a garage.",
      draft: "We built a rocket in a garage. Here is why.",
    },
    {
      id: "b",
      date: "2026-10-09",
      time: "10:00",
      channel: "x",
      title: "Launch day",
      format: "post",
      status: "idea",
      hook: "Three, two, one.",
    },
    {
      id: "c",
      date: "2026-10-21",
      channel: "newsletter",
      title: "October launches",
      format: "newsletter",
      status: "idea",
      draft: "Subject: Our first launch\n\nIt flew.",
    },
  ],
  changes: ["X now once a week"],
};

function overview(patch: Partial<CmoOverview> = {}): CmoOverview {
  return {
    businessName: "acme.io",
    websiteUrl: "https://acme.io",
    brandMedia: null,
    brandBrainConfirmedAt: null,
    organizationSlug: null,
    projectName: "CMO.xyz · acme.io",
    workspaceId: "ws-1",
    sokoBotId: "bot-1",
    projectId: "project-1",
    roomId: "room-1",
    botStatus: "IDLE",
    learning: "done",
    work: null,
    brandVisual: {
      logoUrl: null,
      colors: ["#ff6a00"],
      fonts: ["Inter"],
      siteName: "Acme",
      designMdUrl: null,
      images: [],
    },
    projectLogo: null,
    onboardingStep: "brandBrain",
    mockBilling: false,
    mockPlan: null,
    mockPlanActivatedAt: null,
    routines: [],
    subscriptionActive: false,
    viewerCanApprove: true,
    brandBrain: brain,
    brandBrainUpdatedAt: new Date("2026-10-05T09:01:00Z"),
    strategy,
    media: [],
    ...cmoStrategyVersion(null, new Date("2026-10-05T09:02:00Z")),
    updates: [],
    channels: [],
    upNext: [],
    connectChannelUrl: "http://web/social?projectId=project-1",
    adProviders: [],
    connectAdsUrl: "http://web/ads?projectId=project-1",
    production: { state: "waiting", ready: 0, total: 0, finishedAt: null },
    measurement: [
      {
        provider: "google_analytics",
        name: "Google Analytics",
        measures: "Visits, where they come from and conversions",
        status: "connected",
      },
      {
        provider: "google_search_console",
        name: "Google Search Console",
        measures: "Searches, clicks and rankings",
        status: "none",
      },
    ],
    mailingListSize: 0,
    subscribeUrl: "http://web/billing",
    billing: { plan: null, subscriptionStatus: null, availableCredits: 40 },
    posts: { draft: 0, scheduled: 0, published: 0, failed: 0 },
    createdAt: new Date("2026-10-05T09:00:00Z"),
    ...patch,
  };
}

const running = (kind: "research" | "strategy") => ({
  kind,
  status: "running" as const,
  startedAt: new Date("2026-10-05T09:00:00Z"),
  steps: [
    {
      id: "s1",
      kind: "read" as const,
      label: "Reading acme.io/pricing",
      url: "https://acme.io/pricing",
      status: "done" as const,
      at: new Date("2026-10-05T09:00:05Z"),
    },
  ],
  sectionsSaved: 0,
  sectionsTotal: 16,
});

describe("onboarding steps", () => {
  it("follows what Cuso has done", () => {
    expect(onboardingStep(overview({ brandBrain: null, strategy: null }))).toBe(
      "research",
    );
    expect(onboardingStep(overview({ strategy: null }))).toBe("brain");
    // Approving the Brand Brain opens Cuso's questions before the plan.
    expect(
      onboardingStep(
        overview({ strategy: null, brandBrainConfirmedAt: new Date() }),
      ),
    ).toBe("questions");
    expect(
      onboardingStep(overview({ strategy: null, work: running("strategy") })),
    ).toBe("planning");
    // A change request keeps the plan on screen while Cuso rewrites it.
    expect(onboardingStep(overview({ work: running("strategy") }))).toBe(
      "strategy",
    );
    expect(onboardingStep(overview())).toBe("strategy");
    expect(
      onboardingStep(
        overview({
          ...cmoStrategyVersion(new Date()),
          onboardingStep: "accounts",
        }),
      ),
    ).toBe("connect");
  });

  it("asks each question with yes, no and not sure, and shows the answers", () => {
    const html = renderToStaticMarkup(
      <QuestionsStep
        overview={overview({
          strategy: null,
          brandBrainConfirmedAt: new Date(),
          brandBrain: {
            ...brain,
            questions: [
              {
                id: "main-buyer",
                question: "Do most customers find you through Google?",
                statement: "Most customers find the business through Google",
                section: "marketing",
              },
              {
                id: "offer",
                question: "Is the 14-day trial your main offer?",
                statement: "The 14-day trial is the main offer",
                section: "offer",
                answer: "no",
                note: "Annual plans are",
              },
            ],
          },
        })}
        onAnswer={async () => {}}
        onPlan={async () => null}
      />,
    );
    expect(html).toContain("Do most customers find you through Google?");
    expect(html).toContain("Not sure");
    expect(html).toContain("1 of 2 answered");
    expect(html).toContain("Annual plans are");
    // Unanswered questions never block the plan.
    expect(html).toContain("Skip, plan my month");
  });

  it("resumes on the plan after the Accounts step, even on a reload", () => {
    // Core reads the step from a Social connection or the person's skip.
    expect(
      onboardingStep(
        overview({
          ...cmoStrategyVersion(new Date()),
          onboardingStep: "plan",
        }),
      ),
    ).toBe("pricing");
  });

  it("skips Accounts when the plan has no social network", () => {
    expect(
      onboardingStep(
        overview({
          ...cmoStrategyVersion(new Date()),
          onboardingStep: "accounts",
          strategy: { ...strategy, channels: [] },
        }),
      ),
    ).toBe("pricing");
  });

  it("offers to connect only the social networks in the plan", () => {
    expect(strategySocialChannels(overview())).toEqual(["linkedin", "x"]);
  });
});

describe("research", () => {
  it("shows Cuso's real steps as they happen", () => {
    const html = renderToStaticMarkup(
      <ResearchStep
        overview={overview({ brandBrain: null, work: running("research") })}
        messages={[]}
        onRetry={async () => null}
        onReply={async () => {}}
      />,
    );
    expect(html).toContain("Cuso is studying acme.io");
    expect(html).toContain("Reading acme.io/pricing");
    expect(html).toContain("Live");
  });

  it("stays on finished research until the founder opens the Brand Brain", () => {
    const html = renderToStaticMarkup(
      <ResearchStep
        overview={overview({ work: running("research") })}
        messages={[]}
        onRetry={async () => null}
        onReply={async () => {}}
        onContinue={() => {}}
      />,
    );
    expect(html).toContain("Cuso studied acme.io");
    expect(html).toContain("Reading acme.io/pricing");
    expect(html).toContain("What Cuso did");
    expect(html).toContain("See your Brand Brain");
    expect(html).not.toContain("ob-elapsed");
  });

  it("counts the Brand Brain sections as Cuso writes them", () => {
    const html = renderToStaticMarkup(
      <ResearchStep
        overview={overview({
          brandBrain: null,
          work: { ...running("research"), sectionsSaved: 7 },
        })}
        messages={[]}
        onRetry={async () => null}
        onReply={async () => {}}
      />,
    );
    expect(html).toContain("7 of 16 sections");
  });

  it("says when credits ran out", () => {
    const html = renderToStaticMarkup(
      <ResearchStep
        overview={overview({
          brandBrain: null,
          learning: "failed",
          billing: {
            plan: null,
            subscriptionStatus: null,
            availableCredits: 0,
          },
        })}
        messages={[]}
        onRetry={async () => null}
        onReply={async () => {}}
      />,
    );
    expect(html).toContain("out of credits");
    expect(html).toContain("Try again");
  });
});

describe("strategy", () => {
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

  it("shows the why, what changed, the month and the days", () => {
    const html = renderToStaticMarkup(
      <StrategyStep
        overview={overview()}
        onChange={async () => null}
        onSetAds={async () => null}
        onApprove={async () => {}}
      />,
    );
    expect(html).toContain("Show the rockets working.");
    expect(html).toContain("X now once a week");
    expect(html).toContain("We built a rocket in a garage.");
    // The month shows the busiest feeds as phones, the inbox included.
    expect(html).toContain("Inbox");
    expect(html).toContain("Approve plan");
    expect(html).not.toContain("likes");
  });

  it("tells a member who is not an owner or admin who approves", () => {
    const html = renderToStaticMarkup(
      <StrategyStep
        overview={overview({ viewerCanApprove: false })}
        onChange={async () => null}
        onSetAds={async () => null}
        onApprove={async () => {}}
      />,
    );
    expect(html).not.toContain("Approve plan");
    expect(html).toContain("An owner or admin of the business approves");
  });

  it("leads back to the current step when opened again after approval", () => {
    const html = renderToStaticMarkup(
      <StrategyStep
        overview={overview(cmoStrategyVersion(new Date()))}
        onChange={async () => null}
        onSetAds={async () => null}
        onApprove={async () => {}}
        ahead={{ label: "Accounts", onClick: () => {} }}
      />,
    );
    expect(html).toContain("Continue to Accounts");
    expect(html).not.toContain("Approve plan");
  });
});

describe("plan check", () => {
  const withQuestions = (
    answers: ("yes" | "no" | undefined)[],
  ): CmoOverview => {
    const base = overview();
    return {
      ...base,
      strategy: {
        ...(base.strategy as Strategy),
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

  it("asks the plan's questions after the strategy, before approving", () => {
    const html = renderToStaticMarkup(
      <StrategyStep
        overview={withQuestions([undefined, undefined])}
        onChange={async () => null}
        onSetAds={async () => null}
        onApprove={async () => {}}
        onCheck={() => {}}
      />,
    );
    expect(html).toContain("Then 2 quick checks, yes or no.");
    expect(html).toContain("Continue");
    expect(html).not.toContain("Approve plan");
    expect(html).toContain("Tell Cuso what to change");
  });

  it("approves when every answer is yes, and updates the plan after a no", () => {
    const allYes = renderToStaticMarkup(
      <CheckStep
        overview={withQuestions(["yes", "yes"])}
        onAnswer={async () => {}}
        onUpdate={async () => null}
        onApprove={async () => {}}
      />,
    );
    expect(allYes).toContain("Step 5 of 8");
    expect(allYes).toContain("Do you sell 0 things?");
    expect(allYes).toContain("Approve plan");
    const withNo = renderToStaticMarkup(
      <CheckStep
        overview={withQuestions(["yes", "no"])}
        onAnswer={async () => {}}
        onUpdate={async () => null}
        onApprove={async () => {}}
      />,
    );
    expect(withNo).toContain("Update the plan");
    expect(withNo).toContain("Many more");
  });

  it("resumes on the check after a reload part way through", () => {
    expect(onboardingStep(withQuestions(["yes", undefined]))).toBe("check");
    expect(onboardingStep(withQuestions([undefined, undefined]))).toBe(
      "strategy",
    );
    expect(onboardingStep(withQuestions(["yes", "yes"]))).toBe("strategy");
  });
});

describe("results", () => {
  it("shows the number, Cuso's rhythm and when he changes course", () => {
    const base = overview(cmoStrategyVersion(new Date()));
    const html = renderToStaticMarkup(
      <ResultsStep
        overview={{
          ...base,
          strategy: {
            ...(base.strategy as Strategy),
            objective: {
              metric: "Demo requests",
              target: "20 by 30 Oct",
              baseline: "About 8 a month",
              baselineBasis: "assumption",
            },
            funnel: [
              {
                stage: "awareness",
                name: "Hear about us",
                goal: "Founders see a launch",
                channels: ["linkedin"],
                metric: "Profile visits",
              },
            ],
            measurement: {
              primary: "Demo requests",
              supporting: [],
              tracking: ["UTM links on every post"],
              rules: [
                {
                  when: "A format gets no clicks for two weeks",
                  then: "Swap it for one that works",
                },
              ],
            },
          },
        }}
        next="accounts"
        onContinue={() => {}}
        onConnectMeasurement={async () => ({ url: null, error: null })}
      />,
    );
    expect(html).toContain("Step 6 of 8");
    expect(html).toContain("Not measured yet");
    expect(html).toContain("Google Search Console");
    expect(html).toContain("Connected");
    expect(html).toContain("More demo requests");
    expect(html).toContain("Target: 20 by 30 Oct");
    expect(html).toContain("Profile visits");
    expect(html).toContain("Every Monday");
    expect(html).toContain("Swap it for one that works");
    expect(html).toContain("UTM links on every post");
    expect(html).toContain("Continue to accounts");
  });
});

describe("pricing", () => {
  const plan = (name: "starter" | "standard" | "pro", amount: number) => ({
    name,
    credits: amount * 10,
    currency: "eur",
    monthlyAmount: amount * 100,
    priceId: `price_${name}`,
    productId: `prod_${name}`,
    slug: name,
  });
  const plans = {
    free: { ...plan("starter", 0), name: "free" as const },
    starter: plan("starter", 25),
    standard: plan("standard", 75),
    pro: plan("pro", 200),
  };

  it("prices Sokosumi's real plans and sends checkout to Sokosumi", () => {
    const html = renderToStaticMarkup(
      <PricingStep
        overview={overview()}
        plans={plans}
        onStart={async () => {}}
        onSubscribeLater={async () => {}}
        onRefresh={async () => {}}
        onChooseMockPlan={async () => null}
      />,
    );
    expect(html).toContain("€75");
    expect(html).toContain("750 credits every month");
    expect(html).toContain('href="http://web/billing?tab=subscription"');
    // Subscribe later opens the chat; Cuso spends nothing until a plan.
    expect(html).toContain("Subscribe later");
    expect(html).not.toContain("Choose Growth");
  });

  it("offers CMO's own mock tiers instead of checkout while mock billing is on", () => {
    const html = renderToStaticMarkup(
      <PricingStep
        overview={overview({ mockBilling: true })}
        plans={plans}
        onStart={async () => {}}
        onSubscribeLater={async () => {}}
        onRefresh={async () => {}}
        onChooseMockPlan={async () => null}
      />,
    );
    expect(html).toContain("Choose Growth");
    expect(html).toContain("Recommended");
    expect(html).toContain("Yearly");
    expect(html).not.toContain("http://web/billing");
  });

  it("marks the active mock tier and lets the founder start", () => {
    const html = renderToStaticMarkup(
      <PricingStep
        overview={overview({
          mockBilling: true,
          mockPlan: "growth",
          subscriptionActive: true,
        })}
        plans={plans}
        onStart={async () => {}}
        onSubscribeLater={async () => {}}
        onRefresh={async () => {}}
        onChooseMockPlan={async () => null}
      />,
    );
    expect(html).toContain("Your plan");
    expect(html).toContain("Growth is active");
    expect(html).toContain("Start Cuso");
  });

  it("lets a subscribed founder start", () => {
    const html = renderToStaticMarkup(
      <PricingStep
        overview={overview({
          subscriptionActive: true,
          billing: {
            plan: "standard",
            subscriptionStatus: "active",
            availableCredits: 750,
          },
        })}
        plans={plans}
        onStart={async () => {}}
        onSubscribeLater={async () => {}}
        onRefresh={async () => {}}
        onChooseMockPlan={async () => null}
      />,
    );
    expect(html).toContain("Your plan");
    expect(html).toContain("Start Cuso");
    expect(html).not.toContain("Subscribe later");
  });
});
