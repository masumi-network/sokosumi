import type { CmoOverview } from "@sokosumi/core-client";

import { cmoBilling, cmoStrategyVersion } from "../../../test-fixtures/cmo";
import {
  asking,
  brain,
  draft,
  hex,
  reading,
  richBrain,
  richMedia,
  richPlan,
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
  "plan-unfitted",
  "plan-short",
  "planning",
  "launch",
  "launch-connected",
  "subscribe",
  "subscribe-confirming",
] as const;

export type Screen = (typeof SCREENS)[number];

type Strategy = NonNullable<CmoOverview["strategy"]>;

const fixtureDay = (index: number) =>
  new Date(Date.UTC(2026, 9, 5 + index)).toISOString().slice(0, 10);

/** `perDay` pieces of one format on one network, every day for 28 days. */
function daily(
  channel: string,
  format: string,
  perDay: number,
  pillar: string,
  alsoOn?: string[],
): Strategy["calendar"] {
  return Array.from({ length: 28 }, (_, day) =>
    Array.from({ length: perDay }, (_, slot) => ({
      id: `${channel}-${format}-${day}-${slot}`,
      date: fixtureDay(day),
      channel,
      format,
      title: `${pillar} ${day + 1}.${slot + 1}`,
      status: "idea" as const,
      pillar,
      ...(alsoOn ? { alsoOn } : {}),
    })),
  ).flat();
}

/**
 * A month as cmo-v14 writes it, at the top plan's rates: six X posts a day,
 * one on LinkedIn, two picture posts on Instagram, and seven short videos a
 * day, each one file on TikTok, Reels and Shorts. Each plan makes its share.
 */
const fullMonth: Strategy = {
  ...richPlan,
  channels: [
    { channel: "x", cadence: "6 a day", role: "main" },
    { channel: "linkedin", cadence: "1 a day", role: "main" },
    { channel: "instagram", cadence: "9 a day", role: "main" },
    { channel: "tiktok", cadence: "7 a day", role: "main" },
    { channel: "youtube", cadence: "7 a day", role: "main" },
  ],
  calendar: [
    ...daily("x", "post", 3, "How we build"),
    ...daily("x", "image", 3, "Launch stories"),
    ...daily("linkedin", "image", 1, "Launch stories"),
    ...daily("instagram", "carousel", 2, "How we build"),
    ...daily("tiktok", "video", 4, "How we build", ["instagram", "youtube"]),
    ...daily("instagram", "reel", 2, "Launch stories", ["tiktok", "youtube"]),
    ...daily("youtube", "short", 1, "Launch stories", ["tiktok", "instagram"]),
  ],
};

export function isScreen(value: string): value is Screen {
  return (SCREENS as readonly string[]).includes(value);
}

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
          fonts: ["Inter", "Space Grotesk"],
          siteName: "Acme",
          designMdUrl: "https://acme.io/DESIGN.md",
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
    // Paid for: the accounts, then Launch.
    case "launch":
    case "launch-connected":
      return draft({
        ...cmoStrategyVersion(new Date("2026-10-05T09:10:00Z")),
        onboardingStep: "accounts",
        billing: cmoBilling({
          tier: "growth",
          interval: "month",
          status: "active",
        }),
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
                  personalProfile: false,
                },
              ]
            : [],
      });
    // Approved, nobody paid yet: the CMO plan checkout (ADR 0068).
    case "subscribe":
    case "subscribe-confirming":
      return draft({
        ...cmoStrategyVersion(new Date("2026-10-05T09:10:00Z")),
        onboardingStep: "checkout",
        brandBrain: richBrain,
        strategy: fullMonth,
      });
    // A no on a check that the strategy does not show yet.
    case "plan-unfitted":
      return draft({
        brandBrain: richBrain,
        strategy: {
          ...richPlan,
          changes: [],
          questions: (richPlan.questions ?? []).map((question, at) =>
            at === 0
              ? { ...question, answer: "no", note: "Not this month" }
              : question,
          ),
        },
      });
    // Cuso's finish turns could not fill the month: Core refuses to approve it.
    case "plan-short":
      return draft({
        brandBrain: richBrain,
        strategy: richPlan,
        strategyShort: { planned: 64, promised: 172 },
      });
    // The whole month at the top volume, before a plan is picked.
    case "plan":
      return draft({ brandBrain: richBrain, strategy: fullMonth });
    default:
      return draft({ brandBrain: richBrain, strategy: richPlan });
  }
}
