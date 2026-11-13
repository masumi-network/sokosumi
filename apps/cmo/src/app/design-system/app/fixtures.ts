import type { CmoOverview } from "@sokosumi/core-client";
import { AGENT_NAME } from "../../../lib/agent";
import type { CusoMessage } from "../../../lib/chat-messages";
import { VIEW_PATHS, type View } from "../../../lib/views";
import { cmoOverview, cmoStrategyVersion } from "../../../test-fixtures/cmo";
import { richBrain, richPlan } from "../../../test-fixtures/onboarding";

export const VIEWS = Object.keys(VIEW_PATHS) as View[];

export function isView(value: string): value is View {
  return (VIEWS as string[]).includes(value);
}

type Plan = NonNullable<CmoOverview["strategy"]>;
type Entry = Plan["calendar"][number];

const PICTURE = "/mascot.webp";

function entry(
  day: number,
  channel: string,
  title: string,
  patch: Partial<Entry> = {},
): Entry {
  return {
    id: `e${day}-${channel}`,
    date: `2026-11-${String(day).padStart(2, "0")}`,
    time: "09:00",
    channel,
    title,
    format: "post",
    status: "scheduled",
    pillar: day % 2 ? "Launch stories" : "How we build",
    approach: day % 2 ? "educational" : "product-led",
    hook: `${title}: the short version.`,
    draft: `${title}.\n\nWe build rockets for teams that ship on time.`,
    ...patch,
  };
}

const calendar: Entry[] = [
  entry(2, "linkedin", "Why we built it", { status: "published" }),
  entry(4, "x", "Launch day countdown", {
    status: "published",
    imageFileId: "f1",
  }),
  entry(6, "linkedin", "Inside the test stand", { imageFileId: "f2" }),
  entry(9, "instagram", "Three, two, one", {
    format: "carousel",
    slideFileIds: ["f3", "f4", "f5"],
  }),
  entry(11, "x", "What a slipped launch costs", { status: "draft" }),
  entry(13, "linkedin", "How we plan a launch window", { status: "draft" }),
  entry(16, "facebook", "Meet the crew", { imageFileId: "f6" }),
  entry(18, "x", "Ask us anything", { status: "idea", draft: undefined }),
  entry(20, "linkedin", "Customer story: Moonshot", { status: "idea" }),
  entry(24, "newsletter", "November launches", {
    format: "newsletter",
    status: "draft",
    draft: "Subject: Our November launches\n\nThree flew. One waited.",
  }),
  entry(27, "linkedin", "Lessons from the month", { status: "idea" }),
];

const plan: Plan = {
  ...richPlan,
  month: "2026-11",
  summary: "Show the rockets working, one launch story a week.",
  why: "Product teams read LinkedIn and X.",
  channels: [
    { channel: "linkedin", cadence: "3 a week", why: "Where buyers are" },
    { channel: "x", cadence: "2 a week" },
    { channel: "instagram", cadence: "1 a week" },
    { channel: "facebook", cadence: "1 a week" },
    { channel: "newsletter", cadence: "1 a month" },
  ],
  calendar,
  questions: [],
};

const at = (iso: string) => new Date(`2026-11-${iso}Z`);

export const overview: CmoOverview = cmoOverview({
  ...cmoStrategyVersion(new Date("2026-11-01T09:10:00Z")),
  businessName: "Acme",
  websiteUrl: "https://acme.io",
  projectLogo: PICTURE,
  brandBrain: {
    ...richBrain,
    questions: [],
    profile: {
      company: {
        headline: "Acme builds rockets",
        answer:
          "A twelve-person company in Hamburg that sells reusable rockets.",
        findings: [
          {
            point: "Founded in 2021 by two ex-aerospace engineers.",
            evidence: "fact",
            confidence: "high",
            sourceUrl: "https://acme.io/about",
          },
          {
            point: "Growing about 10% a month.",
            evidence: "claim",
            confidence: "medium",
          },
        ],
      },
      offer: {
        headline: "Rocket Pro for teams",
        answer: "One plan: Rocket Pro at $99 a month with a 14-day trial.",
      },
      customers: {
        headline: "Product teams of ten to fifty",
        answer: "Teams that ship hardware on a deadline.",
      },
      positioning: {
        headline: "The rocket that ships on time",
        answer: "Reliability over price, against Moonshot's discounts.",
      },
      marketing: {
        headline: "Mostly LinkedIn",
        answer: "About one post a week and no ads.",
      },
    },
  },
  brandBrainUpdatedAt: at("01T09:01:00"),
  brandBrainConfirmedAt: at("01T09:05:00"),
  strategy: plan,
  approvedStrategy: plan,
  onboardingStep: "done",
  botStatus: "IDLE",
  viewerCanApprove: true,
  createdAt: at("01T09:00:00"),
  media: [
    { entryId: "e4-x", kind: "image", url: PICTURE },
    { entryId: "e6-linkedin", kind: "image", url: PICTURE },
    {
      entryId: "e9-instagram",
      kind: "image",
      url: PICTURE,
      slides: [PICTURE, PICTURE, PICTURE],
    },
    { entryId: "e16-facebook", kind: "image", url: PICTURE },
  ],
  production: {
    state: "running",
    ready: 8,
    total: 11,
    written: 11,
    pictured: 5,
    needPictures: 6,
    finishedAt: null,
    pillars: {
      shares: [
        { name: "Launch stories", planned: 60, made: 64, pieces: 7 },
        { name: "How we build", planned: 40, made: 36, pieces: 4 },
      ],
      rewriting: false,
    },
  },
  routines: [
    {
      key: "cmo-daily-run",
      name: "Daily marketing run",
      when: "Every day at 09:00",
      description: "Prepares what the calendar has due.",
      nextRunAt: at("06T09:00:00"),
      timezone: "Europe/Berlin",
    },
    {
      key: "cmo-weekly-review",
      name: "Weekly review",
      when: "Mondays at 09:00",
      description: "Reads the week's results and adjusts the plan.",
      nextRunAt: at("09T09:00:00"),
      timezone: "Europe/Berlin",
    },
  ],
  channels: [
    {
      id: "c1",
      provider: "linkedin",
      handle: "acme",
      displayName: "Acme",
      status: "ACTIVE",
    },
    {
      id: "c2",
      provider: "x",
      handle: "acme_rockets",
      displayName: "Acme Rockets",
      status: "ACTIVE",
    },
  ],
  adProviders: ["google_ads"],
  mailingListSize: 128,
  billing: {
    plan: "pro",
    subscriptionStatus: "active",
    availableCredits: 8400,
    tier: "growth",
    interval: "month",
    status: "active",
    periodEnd: new Date("2026-12-13T10:00:00Z"),
    cancelAtPeriodEnd: false,
  },
  posts: { draft: 3, scheduled: 5, published: 2, failed: 0 },
  upNext: [
    {
      id: "e6-linkedin",
      date: "2026-11-06",
      channel: "linkedin",
      title: "Inside the test stand",
      status: "scheduled",
    },
    {
      id: "e9-instagram",
      date: "2026-11-09",
      channel: "instagram",
      title: "Three, two, one",
      status: "scheduled",
    },
    {
      id: "e11-x",
      date: "2026-11-11",
      channel: "x",
      title: "What a slipped launch costs",
      status: "draft",
    },
  ],
  updates: [
    {
      id: "u1",
      kind: "daily",
      headline: "Scheduled two posts and wrote a draft for Tuesday",
      done: [
        "Scheduled “Inside the test stand” on LinkedIn",
        "Made the carousel for Instagram",
      ],
      upNext: ["Draft the newsletter"],
      at: at("04T09:05:00"),
      revertible: false,
      revertedAt: null,
    },
    {
      id: "u2",
      kind: "weekly",
      headline: "Week one: 1,240 profile visits, 31 demo clicks",
      results:
        "LinkedIn carried the week; X posts got about a third of the clicks.",
      changes: ["Move the X launch posts to the morning"],
      at: at("03T09:00:00"),
      revertible: true,
      revertedAt: null,
    },
  ],
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
    {
      provider: "shopify",
      name: "Shopify",
      measures: "Orders and revenue",
      status: "none",
    },
  ],
});

const message = (
  id: string,
  fromCuso: boolean,
  content: string,
  time: string,
): CusoMessage => ({
  id,
  fromCuso,
  author: fromCuso ? AGENT_NAME : "Francis",
  content,
  createdAt: `2026-11-${time}Z`,
});

export const messages: CusoMessage[] = [
  message(
    "m1",
    true,
    "Your month is planned. I will write and schedule every piece.",
    "01T09:12:00",
  ),
  message(
    "m2",
    false,
    "Can the Instagram carousel lead with the test stand?",
    "04T10:00:00",
  ),
  message(
    "m3",
    true,
    "Yes. I moved **Three, two, one** to open on the test stand. See it on the [Calendar](/calendar).",
    "04T10:01:00",
  ),
  message("m4", false, "Great. Keep X posts short.", "04T10:03:00"),
  message(
    "m5",
    true,
    "Done. X posts stay under 200 characters.",
    "04T10:03:30",
  ),
];
