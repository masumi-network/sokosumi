import type { CmoOverview } from "@sokosumi/core-client";

import { cmoStrategyVersion } from "../../../test-fixtures/cmo";
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
  "signed-out",
  "name",
  "hire",
  "start",
  "reading",
  "reading-slow",
  "writing",
  "asking",
  "brand",
  "plan",
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
      return draft({
        brandBrain: richBrain,
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
