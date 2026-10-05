import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { strategySocialChannels } from "./connect-step";
import { onboardingStep } from "./flow";
import { PricingStep } from "./pricing-step";
import { ResearchStep } from "./research-step";
import { showcaseEntries } from "./showcases";
import { planWeeks, StrategyStep } from "./strategy-step";

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
    },
    projectLogo: null,
    accountsDoneAt: null,
    onboardedAt: null,
    routines: [],
    subscriptionActive: false,
    brandBrain: brain,
    brandBrainUpdatedAt: new Date("2026-10-05T09:01:00Z"),
    strategy,
    strategyUpdatedAt: new Date("2026-10-05T09:02:00Z"),
    strategyApprovedAt: null,
    updates: [],
    channels: [],
    upNext: [],
    connectChannelUrl: "http://web/social?projectId=project-1",
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
    // A change request re-plans: the strategy steps back to planning.
    expect(onboardingStep(overview({ work: running("strategy") }))).toBe(
      "planning",
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

  it("shows the why, what changed, the days and the previews", () => {
    const html = renderToStaticMarkup(
      <StrategyStep
        overview={overview()}
        onChange={async () => null}
        onApprove={async () => {}}
      />,
    );
    expect(html).toContain("Founders read LinkedIn.");
    expect(html).toContain("X now once a week");
    expect(html).toContain("We built a rocket in a garage.");
    expect(html).toContain("Your newsletter");
    expect(html).toContain("Our first launch");
    expect(html).toContain("Approve strategy");
    expect(html).not.toContain("likes");
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
      />,
    );
    expect(html).toContain("€75");
    expect(html).toContain("750 credits every month");
    expect(html).toContain('href="http://web/billing?tab=subscription"');
    expect(html).toContain("Start without a plan for now");
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
      />,
    );
    expect(html).toContain("Your plan");
    expect(html).toContain("Start Cuso");
  });
});
