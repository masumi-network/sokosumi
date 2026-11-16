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
  "hire",
  "reading",
  "writing",
  "asking",
  "brand",
  "plan",
  "planning",
  "launch",
  "launch-connected",
  "subscribe",
  "subscribe-confirming",
] as const;

export type Screen = (typeof SCREENS)[number];

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
    // Launched, nobody paid yet: the CMO plan checkout (ADR 0068).
    case "subscribe":
    case "subscribe-confirming":
      return draft({
        ...cmoStrategyVersion(new Date("2026-10-05T09:10:00Z")),
        onboardingStep: "checkout",
        brandBrain: richBrain,
        strategy: richPlan,
      });
    default:
      return draft({ brandBrain: richBrain, strategy: richPlan });
  }
}
