import type { CmoOverview } from "@sokosumi/core-client";

import { cmoStrategyVersion } from "../../../test-fixtures/cmo";
import {
  asking,
  brain,
  draft,
  reading,
  strategy,
  work,
} from "../../../test-fixtures/onboarding";

/** The screens the preview route can render, one overview each. */
export const SCREENS = [
  "hire",
  "reading",
  "writing",
  "asking",
  "brand",
  "plan",
  "planning",
  "launch",
  "launch-connected",
] as const;

export type Screen = (typeof SCREENS)[number];

export function isScreen(value: string): value is Screen {
  return (SCREENS as readonly string[]).includes(value);
}

type Brain = NonNullable<CmoOverview["brandBrain"]>;
type Strategy = NonNullable<CmoOverview["strategy"]>;

const richBrain: Brain = {
  ...brain,
  marketingToday: {
    summary: "Mostly LinkedIn, about one post a week.",
    channels: [
      { name: "LinkedIn", postsPerMonth: 4, basis: "measured" },
      { name: "X", postsPerMonth: 0, basis: "estimated" },
    ],
    ads: { status: "none_found" },
  },
  reveal: {
    positioning: "Rockets for teams that ship on time.",
    insights: [
      {
        title: "Your pricing page speaks to teams",
        detail: "Every plan is priced per team of ten, not per person.",
      },
      {
        title: "Competitors lead with price",
        detail: "Moonshot's homepage opens on a discount.",
      },
    ],
    buyers: [
      {
        role: "Head of product",
        wants: "Launches that land on the day",
        worry: "Vendors that go quiet after the sale",
      },
    ],
  },
};

/** A site colour as Core sends it; the digits stay out of the source's colour literals. */
const hex = (digits: string) => `#${digits}`;

const shot = (url: string) => ({
  url,
  fileId: null,
  pageUrl: "https://acme.io",
});

const richMedia: NonNullable<CmoOverview["brandMedia"]> = {
  capturedAt: "2026-10-05T09:02:00Z",
  pages: [
    { ...shot("/cuso/hero.jpg"), label: "Home", device: "desktop" },
    { ...shot("/cuso/hero.jpg"), label: "Home", device: "mobile" },
  ],
  competitors: [{ ...shot("/cuso/reading-scene.jpg"), name: "Moonshot" }],
  pictures: [],
};

const richPlan: Strategy = {
  ...strategy,
  changes: [],
  why: "Founders read LinkedIn and X, and they trust named people over brands.",
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
      status: "idea",
    },
  ],
  proposals: [
    { channel: "instagram", why: "Product shots", what: "Posts", perMonth: 8 },
  ],
  barrier: {
    kind: "trust",
    text: "Teams have been burned by vendors that go quiet after the sale, so they want to see named people ship.",
  },
  alternatives: [
    {
      sentence: "Lead with price and run a launch discount.",
      why: "It moves fast, but it attracts the buyers who leave first.",
    },
    {
      sentence: "Sell to agencies first, and teams later.",
      why: "Agencies decide quicker, with smaller budgets.",
    },
  ],
  ladder: { core: { what: "Rocket Pro", why: "The plan most teams pick" } },
  beforeAfter: [
    {
      channel: "linkedin",
      before: "One post a month",
      after: "Three posts a week",
    },
  ],
  improvements: [
    {
      area: "pricing",
      idea: "Show the team price on the homepage",
      why: "Buyers look for it first.",
    },
  ],
  idea: {
    who: "Product teams",
    position: "The rocket that ships on time",
    attract: "Launch stories",
    offer: "A 14-day trial",
    sentence:
      "We'll reach product teams with recurring launch backlogs, show named engineers turning briefs into finished launches on LinkedIn and X, and invite them to try the 14-day trial.",
  },
  focus: {
    segment: "Product teams of ten to fifty",
    problem: "Launches slip",
  },
  offer: {
    what: "A 14-day trial of Rocket Pro",
    why: "It removes the risk",
    action: "Start the trial",
  },
  objective: {
    outcome: "More demo requests",
    metric: "Demo requests",
    target: "20 a month",
    baseline: "About 8 a month",
    baselineBasis: "assumption",
  },
  pace: { level: "active", why: "One a day suits a small team", perWeek: 7 },
  ads: {
    monthly: 200,
    currency: "EUR",
    expect: "About 40 trial starts",
    without: "Organic only",
  },
  pillars: [
    { name: "Launch stories", share: 60 },
    { name: "How we build", share: 40 },
  ],
  mix: [
    {
      approach: "educational",
      share: 60,
      why: "Teams trust whoever helps first",
    },
    { approach: "product-led", share: 40, why: "Show the rocket working" },
  ],
  funnel: [
    {
      stage: "awareness",
      name: "Hear about us",
      goal: "Teams see a launch story",
      channels: ["linkedin"],
      metric: "Profile visits",
    },
    {
      stage: "consideration",
      name: "Look closer",
      goal: "Teams read how it works",
      channels: ["linkedin", "x"],
      metric: "Site visits",
    },
    {
      stage: "conversion",
      name: "Start a trial",
      goal: "Teams try it",
      metric: "Trial starts",
      target: "20 a month",
    },
  ],
  measurement: {
    primary: "Demo requests",
    tracking: ["UTM links on every post"],
    rules: [
      {
        when: "A format gets no clicks for two weeks",
        then: "I swap it for one that works",
      },
    ],
  },
  questions: [
    {
      id: "p1",
      question: "Do you ship a product update every month?",
      statement: "They ship monthly.",
    },
    {
      id: "p2",
      question: "Are your buyers on LinkedIn?",
      statement: "Their buyers are on LinkedIn.",
    },
  ],
};

/** The overview each screen renders, with enough data to fill it. */
export function screenOverview(screen: Screen): CmoOverview {
  switch (screen) {
    case "reading":
      return reading({
        work: work("research", { sectionsSaved: 3 }),
      });
    case "writing": {
      const research = work("research", { sectionsSaved: 16 });
      return reading({
        work: {
          ...research,
          steps: [
            ...research.steps,
            {
              id: "s2",
              kind: "search",
              label: "Searching for tools like Acme",
              url: null,
              status: "done",
              at: new Date("2026-10-05T09:01:00Z"),
            },
            {
              id: "s3",
              kind: "brain",
              label: "Saving your Brand Brain",
              url: null,
              status: "running",
              at: new Date("2026-10-05T09:03:40Z"),
            },
          ],
        },
      });
    }
    case "asking":
      return asking({
        brandBrain: {
          ...richBrain,
          questions: [
            ...(brain.questions ?? []),
            {
              id: "q3",
              question: "Do you sell mostly to businesses?",
              statement: "They sell to businesses",
              section: "customers",
            },
          ],
        },
        work: work("research", { sectionsSaved: 9 }),
      });
    case "brand":
      return draft({
        brandBrain: richBrain,
        brandBrainConfirmedAt: null,
        strategy: null,
        brandMedia: richMedia,
        brandVisual: {
          logoUrl: null,
          colors: ["ff6a00", "1b1b1b", "f4e9d8"].map(hex),
          fonts: ["Inter"],
          siteName: "Acme",
          designMdUrl: null,
          images: [],
        },
      });
    case "planning":
      return draft({
        strategy: null,
        work: work("strategy", {
          steps: [
            {
              id: "p1",
              kind: "other",
              label: "Checking your channels",
              url: null,
              status: "done",
              at: new Date("2026-10-05T09:06:00Z"),
            },
            {
              id: "p2",
              kind: "strategy",
              label: "Writing the calendar",
              url: null,
              status: "running",
              at: new Date("2026-10-05T09:07:00Z"),
            },
          ],
        }),
      });
    case "launch":
    case "launch-connected":
      return draft({
        ...cmoStrategyVersion(new Date("2026-10-05T09:10:00Z")),
        onboardingStep: "accounts",
        brandBrain: richBrain,
        strategy: richPlan,
        channels:
          screen === "launch-connected"
            ? [
                {
                  id: "linkedin",
                  provider: "linkedin",
                  handle: "acme",
                  displayName: "Acme",
                  status: "ACTIVE",
                },
              ]
            : [],
      });
    default:
      return draft({ brandBrain: richBrain, strategy: richPlan });
  }
}
