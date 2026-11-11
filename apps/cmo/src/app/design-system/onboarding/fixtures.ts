import type { CmoOverview } from "@sokosumi/core-client";

import { cmoStrategyVersion } from "../../../test-fixtures/cmo";
import {
  asking,
  brain,
  draft,
  hex,
  mappedBrain,
  quickLook,
  reading,
  research,
  richBrain,
  richMedia,
  richPlan,
  sevenPlan,
  work,
} from "../../../test-fixtures/onboarding";

/** The screens the preview route can render, one overview each. */
export const SCREENS = [
  "signed-out",
  "name",
  "hire",
  "start",
  "quick-look",
  "reading",
  "reading-slow",
  "groups",
  "writing",
  "asking",
  "brand",
  "brand-planning",
  "brand-no-map",
  "plan",
  "plan-seven",
  "plan-writing",
  "plan-patched",
  "brand-fixed",
  "planning",
  "planning-slow",
  "launch",
  "launch-connected",
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

/** A look with two real colours, so the previews show both fills. */
const twoColors: CmoOverview["brandVisual"] = {
  ...visual,
  colors: ["1f3a5f", "ff6a00", "f4e9d8"].map(hex),
};

/** Started this long ago: on time, or past twice the usual time. */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

/** The overview each screen renders, with enough data to fill it. */
export function screenOverview(screen: Screen): CmoOverview {
  switch (screen) {
    case "start":
      // Just hired: nothing is in yet, every slot holds its place.
      return reading({
        work: work("research", {
          startedAt: ago(0.2),
          steps: [],
          sections: [],
          sectionsSaved: 0,
        }),
        billing: {
          plan: null,
          subscriptionStatus: null,
          availableCredits: 10_000,
        },
      });
    case "quick-look":
      // Seconds in: the quick look is back, no group has landed yet.
      return reading({
        research: research(0, quickLook),
        work: work("research", {
          startedAt: ago(0.7),
          steps: [
            {
              id: "s1",
              kind: "read",
              label: "Reading acme.io",
              url: "https://acme.io",
              status: "running",
              at: ago(0.5),
            },
          ],
          sections: [],
          sectionsSaved: 0,
        }),
        brandMedia: richMedia,
        brandVisual: visual,
      });
    case "groups":
      // Two groups in, four running; their slots fill as they land.
      return reading({
        research: research(2, quickLook),
        work: work("research", { sectionsSaved: 7, startedAt: ago(3) }),
        brandMedia: richMedia,
        brandVisual: visual,
      });
    case "brand-planning":
      // The research is in and Core started the plan: Brand, while it writes.
      return asking({
        brandBrain: richBrain,
        research: research(6),
        brandMedia: richMedia,
        brandVisual: visual,
        botStatus: "RUNNING",
        work: work("strategy", {
          startedAt: ago(1),
          steps: [
            {
              id: "p1",
              kind: "strategy",
              label: "Writing your strategy",
              url: null,
              status: "running",
              at: ago(0.5),
            },
          ],
        }),
      });
    case "reading":
    case "reading-slow":
      return reading({
        work: work("research", {
          sectionsSaved: 3,
          startedAt: ago(screen === "reading" ? 2 : 15),
        }),
        brandMedia: richMedia,
        brandVisual: visual,
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
    case "brand-no-map":
      return draft({
        brandBrain: screen === "brand" ? mappedBrain : richBrain,
        brandBrainConfirmedAt: null,
        strategy: null,
        brandMedia: richMedia,
        brandVisual: visual,
      });
    case "planning":
    case "planning-slow":
      return draft({
        strategy: null,
        work: work("strategy", {
          startedAt: ago(screen === "planning" ? 1 : 13),
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
    case "plan-writing":
      // The plan part is saved; Cuso writes the calendar, week one first.
      return draft({
        brandBrain: richBrain,
        strategy: { ...richPlan, calendar: [] },
        work: work("strategy", {
          startedAt: ago(2),
          steps: [
            {
              id: "p2",
              kind: "strategy",
              label: "Writing the calendar",
              url: null,
              status: "running",
              at: ago(0.5),
            },
          ],
        }),
      });
    case "plan-patched": {
      // A pace change patched two entries: the old words struck through.
      const [first, second, ...rest] = richPlan.calendar;
      return draft({
        brandBrain: richBrain,
        strategy: {
          ...richPlan,
          calendar: [
            { ...first!, hook: "Two engineers, one garage, one rocket." },
            { ...second!, status: "skipped" },
            ...rest,
          ],
          patched: [
            { id: first!.id, was: first! },
            { id: second!.id, was: second! },
          ],
          changes: ["The launch-day post moved into the garage story."],
        },
      });
    }
    case "brand-fixed": {
      // One tile the founder fixed, one Cuso is still fixing.
      const fix = (fixed: boolean) => ({
        note: "Rocket Pro is 19 dollars a month.",
        at: ago(2).toISOString(),
        fixed,
      });
      return draft({
        brandBrain: {
          ...richBrain,
          profile: {
            offer: {
              answer: "Rocket Pro, 19 dollars a month for teams.",
              findings: [],
              openQuestions: [],
              fix: fix(true),
            },
            customers: {
              answer: "Product teams of ten to fifty.",
              findings: [],
              openQuestions: [],
              fix: fix(false),
            },
          },
        },
        brandBrainConfirmedAt: null,
        strategy: null,
        brandMedia: richMedia,
        brandVisual: visual,
      });
    }
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
    case "plan-seven":
      return draft({
        brandBrain: richBrain,
        strategy: sevenPlan,
        brandVisual: twoColors,
      });
    case "plan-writing":
      // A change on its way (a first plan writes behind the planning
      // screen): three frames, the second Google ad not written yet.
      return draft({
        brandBrain: richBrain,
        strategy: {
          ...sevenPlan,
          changes: ["Search ads start in week one"],
          channels: sevenPlan.channels.filter((channel) =>
            ["x", "google_ads", "newsletter"].includes(channel.channel),
          ),
          calendar: sevenPlan.calendar.filter((entry) =>
            ["x", "google_ads", "newsletter"].includes(entry.channel),
          ),
        },
        brandVisual: twoColors,
        work: work("strategy", { startedAt: ago(2), steps: [] }),
      });
    default:
      return draft({ brandBrain: richBrain, strategy: richPlan });
  }
}
