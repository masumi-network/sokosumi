import type { CmoOverview } from "@sokosumi/core-client";

import type { BriefDone } from "../../../components/onboarding/brief";
import type { CusoMessage } from "../../../lib/chat-messages";
import { cmoStrategyVersion } from "../../../test-fixtures/cmo";
import {
  brain,
  draft,
  hex,
  mappedBrain,
  quickLook,
  reading,
  research,
  richMedia,
  richPlan,
  work,
} from "../../../test-fixtures/onboarding";

/**
 * The screens the preview route renders: each state on the Brief me boards
 * (Brief-Flow-1 and Brief-Flow-2 on the concept canvas), one overview each.
 */
export const SCREENS = [
  "signed-out",
  "name",
  "hire",
  "research",
  "research-question",
  "research-slow",
  "research-error",
  "research-words",
  "brand",
  "brand-fix",
  "plan",
  "briefing-plan",
  "briefing-week",
  "briefing-checks",
  "briefing-ads",
  "briefing-change",
  "approve",
  "connect",
  "connected",
  "month",
  "away",
] as const;

export type Screen = (typeof SCREENS)[number];

export function isScreen(value: string): value is Screen {
  return (SCREENS as readonly string[]).includes(value);
}

/** The brand's look as Core reads it from the site. */
const visual: CmoOverview["brandVisual"] = {
  logoUrl: null,
  colors: ["ff6a00", "1b1b1b", "f4e9d8"].map(hex),
  fonts: ["Inter"],
  siteName: "Acme",
  designMdUrl: null,
  images: [],
};

/** Started this long ago: on time, or past the usual time. */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 10, 16); // Monday 16 Nov 2026
const day = (offset: number) =>
  new Date(START + offset * DAY_MS).toISOString().slice(0, 10);

/** Week one in full (title, brief and why), then titles, as Core saves it. */
const WEEK_ONE: Omit<Entry, "status" | "format">[] = [
  {
    id: "w1-x-mon",
    date: day(0),
    time: "09:00",
    channel: "x",
    title: "A rocket, in 30 seconds",
    brief:
      "Hannah turns one launch brief into a finished rocket, start to end.",
  },
  {
    id: "w1-li-tue",
    date: day(1),
    time: "10:00",
    channel: "linkedin",
    title: "One briefing, a finished launch",
    brief: "How a product team briefs, and what comes back.",
  },
  {
    id: "w1-x-wed",
    date: day(2),
    time: "09:00",
    channel: "x",
    title: "Kit or crew: who does the work?",
    brief: "Moonshot hands you a kit; Acme hands back a launch.",
  },
  {
    id: "w1-li-thu",
    date: day(3),
    time: "10:00",
    channel: "linkedin",
    title: "Lena Brandt on Orbit and Acme",
    brief: "Her quote, and what her team uses it for.",
  },
  {
    id: "w1-ig-fri",
    date: day(4),
    time: "12:00",
    channel: "instagram",
    title: "5 myths about small rockets",
    brief: "A carousel: cost, safety, speed, crews, price.",
  },
  {
    id: "w1-x-fri",
    date: day(4),
    time: "16:00",
    channel: "x",
    title: "Friday launch log",
    brief: "Three launches this week, in one line each.",
  },
  {
    id: "w1-blog-sat",
    date: day(5),
    time: "09:00",
    channel: "seo",
    title: "How to brief a launch in ten minutes",
    brief: "The checklist teams use, with a template.",
  },
];

const FORMATS: Record<string, string> = {
  x: "post",
  linkedin: "post",
  instagram: "carousel",
  seo: "article",
  google_ads: "search_ad",
};

/** Weeks two to four: titles only, plus a search ad each from week two. */
function laterWeeks(): Entry[] {
  const entries: Entry[] = [];
  for (let week = 1; week < 4; week += 1) {
    for (const [offset, channel] of [
      [0, "x"],
      [1, "linkedin"],
      [2, "x"],
      [3, "linkedin"],
      [4, "instagram"],
      [4, "x"],
      [5, "seo"],
    ] as const) {
      entries.push({
        id: `w${week + 1}-${channel}-${offset}`,
        date: day(week * 7 + offset),
        time: "09:00",
        channel,
        format: FORMATS[channel] ?? "post",
        status: "idea",
        title: `Week ${week + 1}: ${channel === "seo" ? "an article" : "a launch story"}`,
      });
    }
    entries.push({
      id: `w${week + 1}-ad`,
      date: day(week * 7 + 1),
      channel: "google_ads",
      format: "search_ad",
      status: "idea",
      title: "Rockets for teams",
      searchAd: {
        keywords: [
          "team rockets",
          "rocket for startups",
          "moonshot alternative",
        ],
        headlines: ["Rockets for Teams", "Ship On the Day", "Start Free"],
        descriptions: [
          "Brief once, get a finished launch back. Start free, no card.",
          "Teams of ten ship on time with Acme.",
        ],
        finalUrl: "https://acme.io/teams",
        location: "Germany",
      },
    });
  }
  return entries;
}

/** A month like the boards' example: a goal, three moves, four weeks, ads. */
const briefPlan: Strategy = {
  ...richPlan,
  month: "2026-11",
  channels: [
    { channel: "x", cadence: "Daily" },
    { channel: "linkedin", cadence: "2 a week" },
    { channel: "instagram", cadence: "1 a week" },
    { channel: "seo", cadence: "1 a week" },
    { channel: "google_ads", cadence: "1 a week from week two" },
  ],
  objective: {
    outcome:
      "Get product teams to start free on Acme, by showing rockets doing real launches.",
    metric: "Free sign-ups",
  },
  funnel: [
    {
      stage: "awareness",
      name: "Hear about us",
      goal: "Show a rocket at work on X, every day",
      channels: ["x"],
      metric: "Profile visits",
      plays: [
        {
          channel: "x",
          what: "Buyers trust what they see done",
          cadence: "daily",
        },
      ],
    },
    {
      stage: "consideration",
      name: "Look closer",
      goal: "Compare launch kits honestly, task by task",
      channels: ["seo", "google_ads"],
      metric: "Site visits",
      plays: [
        {
          channel: "seo",
          what: "Searches for “Moonshot alternative” are where buyers decide",
        },
      ],
    },
    {
      stage: "conversion",
      name: "Start free",
      goal: "Let Orbit Labs and Lena Brandt vouch for you",
      channels: ["linkedin"],
      metric: "Free sign-ups",
      plays: [
        { channel: "linkedin", what: "Named proof is your strongest asset" },
      ],
    },
  ],
  pace: { level: "all_in", why: "Teams decide fast", perWeek: 7 },
  ads: {
    monthly: 300,
    currency: "USD",
    expect: "About 60 free sign-ups",
    without: "I post only",
    setByOwner: false,
  },
  questions: [
    {
      id: "pq1",
      question: "Do you ship a product update every month?",
      statement: "A monthly update post closes each month.",
    },
    {
      id: "pq2",
      question: "Can I quote Lena Brandt from Orbit Labs?",
      statement: "Thursday's LinkedIn post quotes Lena Brandt.",
    },
    {
      id: "pq3",
      question: "Is the free plan open to anyone, with no card?",
      statement: "Every post ends on “Start free, no card”.",
    },
  ],
  calendar: [
    ...WEEK_ONE.map((entry) => ({
      ...entry,
      format: FORMATS[entry.channel] ?? "post",
      status: "idea" as const,
      why: "Built on your Brand Brain",
    })),
    ...laterWeeks(),
  ],
  changes: [],
  patched: [],
};

/** A brand question about a section Core has already saved. */
const pricingBrain: NonNullable<CmoOverview["brandBrain"]> = {
  ...mappedBrain,
  profile: {
    pricing: {
      answer:
        "Free, Team €25, Pro €75 and Fleet €200 a month per team. Each launch shows its price before it runs.",
      findings: [
        {
          point: "Four plans, priced per team.",
          evidence: "fact",
          confidence: "high",
          sourceUrl: "https://acme.io/pricing",
        },
      ],
      openQuestions: [],
    },
    customers: {
      answer: "Product teams at large companies.",
      findings: [],
      openQuestions: [],
    },
  },
  questions: [
    {
      id: "bq1",
      question: "Is the free plan open to anyone, with no card?",
      statement: "Anyone can start free without a card",
      section: "pricing",
    },
    ...(brain.questions ?? []),
    {
      id: "bq4",
      question: "Do you sell mostly to businesses?",
      statement: "They sell to businesses",
      section: "customers",
    },
  ],
};

/** Every question answered: the brand waits only for its check. */
const answeredBrain: NonNullable<CmoOverview["brandBrain"]> = {
  ...pricingBrain,
  questions: (pricingBrain.questions ?? []).map((question) => ({
    ...question,
    answer: "yes" as const,
  })),
};

const writingPlan = work("strategy", {
  startedAt: ago(1),
  steps: [
    {
      id: "p1",
      kind: "strategy",
      label: "Writing four weeks, day by day",
      url: null,
      status: "running",
      at: ago(0.5),
    },
  ],
});

const approved = cmoStrategyVersion(new Date("2026-11-13T09:10:00Z"));
const unconfirmed = { brandBrainConfirmedAt: null };

/** The overview each screen renders, with enough data to fill it. */
export function screenOverview(screen: Screen): CmoOverview {
  switch (screen) {
    case "research":
      return reading({
        research: research(2, quickLook),
        work: work("research", {
          startedAt: ago(2),
          steps: [
            ...work("research").steps,
            {
              id: "s2",
              kind: "study",
              label: "Studying moonshot.io",
              url: "https://moonshot.io",
              status: "running",
              at: ago(0.2),
            },
          ],
        }),
        brandMedia: richMedia,
        brandVisual: visual,
      });
    case "research-slow":
      return reading({
        research: research(3, quickLook),
        work: work("research", { sectionsSaved: 9, startedAt: ago(9) }),
      });
    case "research-error":
      return reading({
        research: research(3),
        learning: "failed",
        work: work("research", { status: "failed", sectionsSaved: 9 }),
      });
    case "research-words":
      return reading({
        research: research(2),
        learning: "done",
        work: work("research", { status: "done", sectionsSaved: 4 }),
      });
    case "research-question":
      return draft({
        ...unconfirmed,
        strategy: null,
        brandBrain: pricingBrain,
        research: research(5),
        work: work("research", { sectionsSaved: 14 }),
        brandMedia: richMedia,
        brandVisual: visual,
      });
    case "brand":
      return draft({
        ...unconfirmed,
        strategy: null,
        brandBrain: answeredBrain,
        research: research(6),
        work: writingPlan,
        brandMedia: richMedia,
        brandVisual: visual,
      });
    case "brand-fix":
      return draft({
        ...unconfirmed,
        strategy: null,
        brandBrain: {
          ...answeredBrain,
          profile: {
            ...answeredBrain.profile,
            customers: {
              answer: "Product teams at large companies.",
              findings: [],
              openQuestions: [],
              fix: {
                note: "We sell to agencies too, not only in-house teams.",
                at: ago(0.5).toISOString(),
                fixed: false,
              },
            },
          },
        },
        research: research(6),
        work: writingPlan,
        brandMedia: richMedia,
      });
    case "plan":
      return draft({
        brandBrain: answeredBrain,
        research: research(6),
        strategy: { ...briefPlan, calendar: briefPlan.calendar.slice(0, 9) },
        work: writingPlan,
      });
    case "briefing-plan":
    case "briefing-week":
    case "briefing-checks":
    case "briefing-ads":
      return draft({
        brandBrain: answeredBrain,
        research: research(6),
        strategy: {
          ...briefPlan,
          questions:
            screen === "briefing-ads"
              ? (briefPlan.questions ?? []).map((question) => ({
                  ...question,
                  answer: "yes" as const,
                }))
              : screen === "briefing-checks"
                ? (briefPlan.questions ?? []).map((question, index) =>
                    index === 0
                      ? { ...question, answer: "yes" as const }
                      : question,
                  )
                : briefPlan.questions,
        },
      });
    case "briefing-change":
      return draft({
        brandBrain: answeredBrain,
        strategy: {
          ...briefPlan,
          calendar: briefPlan.calendar.map((entry) =>
            entry.id === "w1-li-thu"
              ? {
                  ...entry,
                  brief:
                    "Plain words, no hype: what her team hands to its rockets.",
                }
              : entry,
          ),
          patched: [
            {
              id: "w1-li-thu",
              was: briefPlan.calendar.find(
                (entry) => entry.id === "w1-li-thu",
              ) as Entry,
            },
          ],
        },
        work: work("strategy", {
          change: "patch",
          startedAt: ago(0.3),
          steps: [
            {
              id: "c1",
              kind: "strategy",
              label: "Rewriting 1 piece and checking the week",
              url: null,
              status: "running",
              at: ago(0.1),
            },
          ],
        }),
      });
    case "approve":
      return draft({
        brandBrain: answeredBrain,
        strategy: {
          ...briefPlan,
          questions: (briefPlan.questions ?? []).map((question) => ({
            ...question,
            answer: "yes" as const,
          })),
          ads: {
            ...(briefPlan.ads as NonNullable<Strategy["ads"]>),
            setByOwner: true,
          },
        },
      });
    case "connect":
    case "connected":
    case "month":
      return draft({
        ...approved,
        onboardingStep: "accounts",
        brandBrain: answeredBrain,
        strategy: briefPlan,
        approvedStrategy: briefPlan,
        channels:
          screen === "connect"
            ? []
            : [
                {
                  id: "x",
                  provider: "x",
                  handle: "acme",
                  displayName: "Acme",
                  status: "ACTIVE",
                },
              ],
        production:
          screen === "month"
            ? {
                state: "running",
                ready: 12,
                total: 31,
                written: 18,
                pictured: 6,
                needPictures: 12,
                finishedAt: null,
                pillars: null,
              }
            : draft().production,
      });
    case "away":
      // Cuso finished the read and the plan while the person was away.
      return draft({
        ...unconfirmed,
        brandBrain: pricingBrain,
        research: research(6),
        strategy: briefPlan,
        work: null,
      });
    default:
      return reading({ research: research(0, quickLook) });
  }
}

/** Briefing steps already gone through on this device, per screen. */
export function screenBriefed(screen: Screen): BriefDone[] {
  switch (screen) {
    case "briefing-week":
      return ["plan"];
    case "briefing-checks":
    case "briefing-ads":
    case "briefing-change":
      return ["plan", "pace"];
    case "approve":
      return ["plan", "pace", "ads"];
    default:
      return [];
  }
}

/** Launch was pressed: Your month. */
export function screenLaunched(screen: Screen): boolean {
  return screen === "month";
}

/** The read ended with Cuso asking in his own words. */
export function screenMessages(screen: Screen): CusoMessage[] {
  return screen === "research-words"
    ? [
        {
          id: "m1",
          fromCuso: true,
          author: "Cuso",
          content:
            "Your site shows two products: rockets for teams and a parts shop for builders. Which one should this month sell?",
          createdAt: "2026-11-13T09:04:00Z",
        },
      ]
    : [];
}
