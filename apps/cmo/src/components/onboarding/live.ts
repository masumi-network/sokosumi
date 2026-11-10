import type { CmoOverview } from "@sokosumi/core-client";

import { AGENT_NAME } from "../../lib/agent";
import type { CusoMessage } from "../../lib/chat-messages";
import { strategyApproved } from "../../lib/strategy";
import { hostOf } from "../brand-profile";
import { elapsedLabel } from "./checklist";
import { strategySocialChannels } from "./launch-step";
import type { PlanPhase, SitePhase } from "./step";

type Work = NonNullable<CmoOverview["work"]>;

/**
 * How long each wait usually takes, in seconds: the production medians from
 * the speed review (2026-11-09), research p50 412 s and plan p50 329 s.
 */
export const USUAL_SECONDS: Record<Work["kind"], number> = {
  research: 7 * 60,
  strategy: 6 * 60,
};

/** One line of slow copy, and whether Try again shows beside it. */
export interface SlowCopy {
  line: string;
  retry: boolean;
}

/**
 * The time so far against the usual time. Past the usual time it says so;
 * from twice the usual time it offers Try again. Never a percentage.
 */
export function slowCopy(elapsed: number, usual: number): SlowCopy {
  const so = elapsedLabel(elapsed);
  const typical = `usually about ${Math.round(usual / 60)} min`;
  if (elapsed >= usual * 2) {
    return {
      line: `Taking much longer than usual: ${so}, ${typical}. Nothing is lost if you try again.`,
      retry: true,
    };
  }
  if (elapsed >= usual) {
    return {
      line: `Taking longer than usual: ${so}, ${typical}`,
      retry: false,
    };
  }
  return { line: `${so}, ${typical}`, retry: false };
}

/** What Cuso is doing now, from Core's work labels; null once he stopped. */
export function liveLine(
  overview: CmoOverview,
): { label: string; work: Work } | null {
  const work = overview.work;
  if (work?.status !== "running") return null;
  const step =
    work.steps.findLast((candidate) => candidate.status === "running") ??
    work.steps.at(-1);
  return {
    label:
      step?.label ??
      (work.kind === "research"
        ? `Reading ${hostOf(overview.websiteUrl)}`
        : "Planning your month"),
    work,
  };
}

/** What the screen shows, for the heading above the panel. */
export type TitleView =
  | {
      step: "site";
      overview: CmoOverview;
      messages: CusoMessage[];
      phase: SitePhase;
      finished: boolean;
    }
  | { step: "brand"; overview: CmoOverview }
  | { step: "plan"; overview: CmoOverview; phase: PlanPhase; running: boolean }
  | { step: "launch"; overview: CmoOverview; launched: boolean };

/** Cuso stopped to ask something in words, instead of saving a Brand Brain. */
export function siteQuestion(
  overview: CmoOverview,
  messages: CusoMessage[],
  phase: SitePhase,
): CusoMessage | undefined {
  const stopped =
    phase === "failed" &&
    overview.learning !== "failed" &&
    overview.work?.status !== "failed";
  return stopped
    ? [...messages].reverse().find((message) => message.fromCuso)
    : undefined;
}

/** The one heading of the onboarding shell; it changes in place with the step. */
export function stepTitle(view: TitleView): string {
  const site = hostOf(view.overview.websiteUrl);
  switch (view.step) {
    case "site": {
      const asked = siteQuestion(view.overview, view.messages, view.phase);
      if (view.phase === "failed" && !asked) return "The read stopped.";
      if (asked) return "I have a question.";
      const questions = view.overview.brandBrain?.questions?.length ?? 0;
      if (view.phase === "reading" && !view.finished) {
        return questions > 0
          ? `Reading ${site}. Answer a few while you wait.`
          : `Reading ${site}.`;
      }
      return view.finished
        ? `I read ${site}.`
        : `I read ${site}. Answer a few before I show you.`;
    }
    case "brand":
      return `Here's ${site} as I see it.`;
    case "plan":
      if (view.phase === "planning") {
        return view.running ? "Writing your plan" : "Planning stopped";
      }
      if (view.phase === "writing-needed" || !view.overview.strategy) {
        return "Ready to write your plan";
      }
      return strategyApproved(view.overview)
        ? "Your first month, approved."
        : "Your first month.";
    case "launch":
      if (view.launched) return `${AGENT_NAME} is live.`;
      return strategySocialChannels(view.overview).length > 0
        ? "One thing, then I start."
        : "Ready when you are.";
  }
}

/** What hiring set up for the business, read from the overview. */
export function setupRows(overview: CmoOverview): string[] {
  const credits = overview.billing.availableCredits;
  return [
    `Organization "${overview.businessName}" and its workspace`,
    ...(credits > 0
      ? [`${credits.toLocaleString("en-US")} starter credits`]
      : []),
    `Project "${overview.projectName}"`,
    `${AGENT_NAME} hired, with his own chat`,
  ];
}
