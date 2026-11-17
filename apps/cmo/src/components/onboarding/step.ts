import type { CmoOverview } from "@sokosumi/core-client";

import type { SkippedStep } from "../../lib/skipped-steps";
import { strategyApproved } from "../../lib/strategy";

/**
 * The five moments of hiring Cuso. "plan" is the marketing strategy; paying
 * for a CMO plan is "checkout" (ADR 0068), before the accounts and Launch.
 */
export type OnboardingStep = "site" | "brand" | "plan" | "checkout" | "launch";

/**
 * What the step shows: Site reads or asks, Plan waits, asks for a plan, or
 * reviews, the checkout offers the plans or waits for Polar's confirmation.
 */
type Phase =
  | "choosing"
  | "confirming"
  | "reading"
  | "asking"
  | "failed"
  | "planning"
  | "writing-needed"
  | "review";

/** The phases of the Research step. */
export type SitePhase = Extract<Phase, "reading" | "asking" | "failed">;

export type PlanPhase = Extract<
  Phase,
  "planning" | "writing-needed" | "review"
>;

export type CheckoutPhase = Extract<Phase, "choosing" | "confirming">;

type Position =
  | { step: "site"; phase: SitePhase }
  | { step: "checkout"; phase: CheckoutPhase }
  | { step: "brand" | "launch"; phase: "review" }
  | { step: "plan"; phase: PlanPhase };

export const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: "site", label: "Research" },
  { id: "brand", label: "Brand" },
  { id: "plan", label: "Plan" },
  { id: "checkout", label: "Subscribe" },
  { id: "launch", label: "Launch" },
];

export function stepIndex(step: OnboardingStep): number {
  return STEPS.findIndex((candidate) => candidate.id === step);
}

/** Cuso's yes/no questions about the brand that the founder has not answered. */
function unansweredBrandQuestions(overview: CmoOverview) {
  return (overview.brandBrain?.questions ?? []).filter(
    (question) => !question.answer,
  );
}

/**
 * A no on the plan's checks that Cuso has not fitted the plan to yet.
 * A non-empty `changes` list means the last revision already fitted the
 * nos of that round; Core clears `changes` when a new or changed no lands
 * so Update plan shows again.
 */
export function planUnfitted(overview: CmoOverview): boolean {
  const strategy = overview.strategy;
  return (
    (strategy?.questions ?? []).some((question) => question.answer === "no") &&
    (strategy?.changes ?? []).length === 0
  );
}

/**
 * Where the founder is, from what Cuso has done so far, what they skipped,
 * and whether this page is Polar's return after a payment.
 */
export function onboardingStep(
  overview: CmoOverview,
  skipped: readonly SkippedStep[] = [],
  { returnedFromCheckout = false }: { returnedFromCheckout?: boolean } = {},
): Position {
  const work = overview.work;
  const strategy = overview.strategy;
  if (!overview.brandBrain) {
    // Done with no Brand Brain: Cuso stopped short, so the founder needs a retry.
    const settled = work?.kind === "research" ? work.status : overview.learning;
    return {
      step: "site",
      phase: settled === "running" ? "reading" : "failed",
    };
  }
  const asks =
    !skipped.includes("questions") &&
    unansweredBrandQuestions(overview).length > 0;
  const approved = strategyApproved(overview);
  // An approved plan is paid for first (Core owes the checkout until his
  // Project has a CMO subscription or Tester credits), then launched.
  if (strategy && approved) {
    if (overview.onboardingStep === "checkout") {
      // Polar's confirmation arrives after the person does.
      return {
        step: "checkout",
        phase: returnedFromCheckout ? "confirming" : "choosing",
      };
    }
    return { step: "launch", phase: "review" };
  }

  // Cuso starts the first plan himself once the research ends; it is the
  // Plan step only after the founder confirms the brand.
  if (
    !strategy &&
    work?.kind === "strategy" &&
    work.status !== "done" &&
    overview.brandBrainConfirmedAt
  ) {
    return { step: "plan", phase: "planning" };
  }
  if (!overview.brandBrainConfirmedAt && !approved) {
    // The essentials save before Cuso writes the reveal and his notes, so the
    // read stays live until his turn ends.
    if (work?.kind === "research" && work.status === "running") {
      return { step: "site", phase: "reading" };
    }
    if (asks) return { step: "site", phase: "asking" };
    return { step: "brand", phase: "review" };
  }
  if (!strategy) {
    // Confirmed before questions moved to Site: they are still asked there.
    if (asks) return { step: "site", phase: "asking" };
    return { step: "plan", phase: "writing-needed" };
  }

  // Cuso saves a first plan in two parts, the calendar last: it waits on the
  // planning screen until there is a whole plan to approve. Answered checks
  // mean Cuso is fitting a plan the founder has seen.
  const firstPlan =
    (strategy.changes ?? []).length === 0 &&
    !(strategy.questions ?? []).some((question) => question.answer);
  // A patch or brand fix changes a few pieces: the plan stays on screen.
  const writing =
    work?.kind === "strategy" && work.status === "running" && !work.change;
  if (firstPlan && (writing || strategy.calendar.length === 0)) {
    return { step: "plan", phase: "planning" };
  }
  return { step: "plan", phase: "review" };
}
