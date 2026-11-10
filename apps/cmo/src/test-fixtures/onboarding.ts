import type { CmoOverview } from "@sokosumi/core-client";

import { BRAND_SECTIONS, type BrandSectionKey } from "../lib/brand-sections";
import { cmoOverview, cmoStrategy } from "./cmo";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Brain = NonNullable<CmoOverview["brandBrain"]>;

/** A Brand Brain with two open questions, the base of the onboarding screens. */
export const brain: Brain = {
  summary: "Acme sells rockets. Founders buy them.",
  voice: {
    tone: "Direct. Plain words.",
    do: ["Be brief"],
    dont: [],
    examples: [],
  },
  audience: ["Founders"],
  products: ["Rockets"],
  offers: [
    { name: "Rocket Pro", what: "A rocket for teams", price: "$99 a month" },
  ],
  competitors: [{ name: "Moonshot", url: "https://moonshot.io" }],
  channels: [{ name: "LinkedIn", url: "https://linkedin.com/company/acme" }],
  questions: [
    {
      id: "q1",
      question: "Do most customers find you through Google?",
      statement: "Most customers find the business through Google",
      section: "marketing",
    },
    {
      id: "q2",
      question: "Is the 14-day trial your main offer?",
      statement: "The 14-day trial is the main offer",
      section: "offer",
    },
  ],
};

/** A whole plan on LinkedIn, X and a newsletter. */
export const strategy: Strategy = {
  ...cmoStrategy,
  summary: "Show the rockets working.",
  why: "Founders read LinkedIn.",
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

const HEADLINES: Partial<Record<BrandSectionKey, string>> = {
  company: "Rockets for founders, since 2019",
  offer: "Rocket Pro, for teams",
  problems: "Launches take months, not days",
};

/** The first `count` sections in profile order, as Core reports them saved. */
export const savedSections = (count: number) =>
  (Object.keys(BRAND_SECTIONS) as BrandSectionKey[])
    .slice(0, count)
    .map((key) => ({
      key,
      headline: HEADLINES[key] ?? `What Acme found on ${key}`,
    }));

/** Cuso at work: one step done, seven of sixteen sections saved. */
export const work = (
  kind: "research" | "strategy",
  patch: Partial<NonNullable<CmoOverview["work"]>> = {},
): NonNullable<CmoOverview["work"]> => ({
  kind,
  status: "running",
  startedAt: new Date("2026-10-05T09:00:00Z"),
  steps: [
    {
      id: "s1",
      kind: "read",
      label: "Reading acme.io/pricing",
      url: "https://acme.io/pricing",
      status: "done",
      at: new Date("2026-10-05T09:00:05Z"),
    },
  ],
  sections: savedSections(patch.sectionsSaved ?? 7),
  sectionsSaved: 7,
  sectionsTotal: 16,
  ...patch,
});

/** Reading the site: no Brand Brain yet. */
export const reading = (patch: Partial<CmoOverview> = {}) =>
  cmoOverview({
    brandBrain: null,
    strategy: null,
    work: work("research"),
    ...patch,
  });
/** The Brand Brain is saved with its questions; the read may still run. */
export const asking = (patch: Partial<CmoOverview> = {}) =>
  cmoOverview({ brandBrain: brain, strategy: null, ...patch });
/** A confirmed Brand Brain and a plan nobody approved yet. */
export const draft = (patch: Partial<CmoOverview> = {}) =>
  cmoOverview({
    businessName: "acme.io",
    brandBrain: brain,
    brandBrainConfirmedAt: new Date("2026-10-05T09:05:00Z"),
    strategy,
    ...patch,
  });

/** A site colour as Core sends it; digits stay out of colour literals in source. */
export const hex = (digits: string) => `#${digits}`;

const shot = (url: string) => ({
  url,
  fileId: null,
  pageUrl: "https://acme.io",
});

/** Brand media with hero shots, for Brand / design-system screens. */
export const richMedia: NonNullable<CmoOverview["brandMedia"]> = {
  capturedAt: "2026-10-05T09:02:00Z",
  pages: [
    { ...shot("/cuso/hero.jpg"), label: "Home", device: "desktop" },
    { ...shot("/cuso/hero.jpg"), label: "Home", device: "mobile" },
  ],
  competitors: [{ ...shot("/cuso/reading-scene.jpg"), name: "Moonshot" }],
  pictures: [],
};

/** A Brand Brain filled enough to render every Brand tile. */
export const richBrain: Brain = {
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

/** A plan filled enough for Plan / Results / design-system app views. */
export const richPlan: Strategy = {
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

/** A Brand Brain whose read placed Acme among three rivals on two axes. */
export const mappedBrain: Brain = {
  ...richBrain,
  competitors: [
    {
      name: "Moonshot",
      url: "https://moonshot.io",
      note: "Leads with a launch discount.",
    },
    { name: "Orbit Labs", note: "Rockets for enterprises, sold by sales." },
  ],
  alternatives: [{ name: "Build it" }],
  reveal: {
    ...(richBrain.reveal as NonNullable<Brain["reveal"]>),
    map: {
      x: { low: "For one person", high: "For whole teams" },
      y: { low: "Do it yourself", high: "Done for you" },
      players: [
        { name: "Acme", x: 70, y: 72, you: true },
        { name: "Moonshot", x: 40, y: 60 },
        { name: "Orbit Labs", x: 88, y: 30 },
        { name: "Build it in house", x: 15, y: 20 },
      ],
    },
  },
};

type Entry = Strategy["calendar"][number];
const piece = (
  id: string,
  channel: string,
  format: string,
  patch: Partial<Entry> = {},
): Entry => ({
  id,
  date: "2026-10-07",
  time: "09:00",
  channel,
  format,
  title: `Launch on ${channel}`,
  status: "idea",
  hook: `Ship your launch on ${channel}.`,
  draft: `Ship your launch on ${channel}. Here is how a team of ten does it.`,
  ...patch,
});

/** The plan on seven of October's preview frames: every network, both ads and a newsletter. */
export const sevenPlan: Strategy = {
  ...richPlan,
  channels: [
    "x",
    "linkedin",
    "instagram",
    "facebook",
    "meta_ads",
    "google_ads",
    "newsletter",
  ].map((channel) => ({ channel, cadence: "1 a week" })),
  calendar: [
    piece("s-news", "newsletter", "newsletter", {
      title: "October launches",
      draft: "Subject: Our first launch\n\nIt flew, on the day.",
    }),
    piece("s-google-1", "google_ads", "search_ad", {
      title: "Rockets for Teams · Ship on Time",
      hook: "Rockets for Teams · Ship on Time",
    }),
    piece("s-google-2", "google_ads", "search_ad", {
      date: "2026-10-08",
      title: "Rocket Pro · 14-Day Free Trial",
      hook: "Rocket Pro · 14-Day Free Trial",
      draft: undefined,
    }),
    piece("s-meta", "meta_ads", "image", { title: "Try it free" }),
    piece("s-fb", "facebook", "post"),
    piece("s-ig-1", "instagram", "image", { hook: "Launch day" }),
    piece("s-ig-2", "instagram", "image", {
      date: "2026-10-08",
      hook: "Meet the crew",
    }),
    piece("s-li", "linkedin", "post"),
    piece("s-x", "x", "post"),
  ],
};
