import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { planWeeks } from "../../lib/calendar";
import { showcaseEntries } from "../showcases";
import { strategySocialChannels } from "./connect-step";
import { onboardingStep } from "./flow";
import { PricingStep } from "./pricing-step";
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
    id: "cmo-1",
    businessName: "acme.io",
    websiteUrl: "https://acme.io",
    goals: "More sales",
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
    accountsDoneAt: null,
    mockBilling: false,
    mockPlan: null,
    mockPlanActivatedAt: null,
    onboardedAt: null,
    routines: [],
    subscriptionActive: false,
    brandBrain: brain,
    brandBrainUpdatedAt: new Date("2026-10-05T09:01:00Z"),
    strategy,
    media: [],
    strategyUpdatedAt: new Date("2026-10-05T09:02:00Z"),
    strategyApprovedAt: null,
    updates: [],
    channels: [],
    upNext: [],
    connectChannelUrl: "http://web/social?projectId=project-1",
    adProviders: [],
    connectAdsUrl: "http://web/ads?projectId=project-1",
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
    expect(
      onboardingStep(overview({ strategy: null, work: running("strategy") })),
    ).toBe("planning");
    // A change request keeps the plan on screen while Cuso rewrites it.
    expect(onboardingStep(overview({ work: running("strategy") }))).toBe(
      "strategy",
    );
    expect(onboardingStep(overview())).toBe("strategy");
    expect(onboardingStep(overview({ strategyApprovedAt: new Date() }))).toBe(
      "connect",
    );
  });

  it("resumes on the plan after the Accounts step, even on a reload", () => {
    expect(
      onboardingStep(
        overview({
          strategyApprovedAt: new Date(),
          accountsDoneAt: new Date(),
        }),
      ),
    ).toBe("pricing");
  });

  it("skips Accounts when the plan has no social network", () => {
    expect(
      onboardingStep(
        overview({
          strategyApprovedAt: new Date(),
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

  it("leads back to the current step when opened again after approval", () => {
    const html = renderToStaticMarkup(
      <StrategyStep
        overview={overview({ strategyApprovedAt: new Date() })}
        onChange={async () => null}
        onApprove={async () => {}}
        ahead={{ label: "Accounts", onClick: () => {} }}
      />,
    );
    expect(html).toContain("Continue to Accounts");
    expect(html).not.toContain("Approve plan");
  });
});

describe("results", () => {
  it("shows the number, Cuso's rhythm and when he changes course", () => {
    const base = overview({ strategyApprovedAt: new Date() });
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
      />,
    );
    expect(html).toContain("Step 4 of 6");
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
        onRefresh={async () => {}}
        onChooseMockPlan={async () => null}
      />,
    );
    expect(html).toContain("€75");
    expect(html).toContain("750 credits every month");
    expect(html).toContain('href="http://web/billing?tab=subscription"');
    expect(html).toContain("Subscribe later");
    expect(html).not.toContain("Choose Growth");
  });

  it("offers CMO's own mock tiers instead of checkout while mock billing is on", () => {
    const html = renderToStaticMarkup(
      <PricingStep
        overview={overview({ mockBilling: true })}
        plans={plans}
        onStart={async () => {}}
        onRefresh={async () => {}}
        onChooseMockPlan={async () => null}
      />,
    );
    expect(html).toContain("Choose Growth");
    expect(html).toContain("Recommended");
    expect(html).toContain("Yearly");
    expect(html).not.toContain("http://web/billing");
    expect(html).toContain("Subscribe later");
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
        onRefresh={async () => {}}
        onChooseMockPlan={async () => null}
      />,
    );
    expect(html).toContain("Your plan");
    expect(html).toContain("Start Cuso");
  });
});
