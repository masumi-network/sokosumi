import type { CmoBrandBrain, CmoStrategy } from "@sokosumi/soko-bot";

import { evaluateWithJev } from "@/lib/soko-bot/jev";

/** Saves in one planning turn the review answers; past them Cuso finishes as he is. */
export const CMO_PLAN_REVIEWS_PER_TURN = 4;

const MIN_PIECES = 16;
const MIN_FORMATS = 6;
const MAX_SUMMARY_WORDS = 20;

/**
 * What a saved plan breaks of the strategy skill's hard rules, in words Cuso
 * can act on. Calendar rules wait until a calendar is saved.
 */
export function cmoPlanProblems(strategy: CmoStrategy): string[] {
  const problems: string[] = [];
  const words = strategy.summary.trim().split(/\s+/).length;
  if (words > MAX_SUMMARY_WORDS)
    problems.push(
      `summary has ${words} words; keep it to ${MAX_SUMMARY_WORDS}.`,
    );
  if (strategy.mix.length === 0)
    problems.push("mix is empty; give two to four approaches.");
  if (strategy.funnel.length < 3)
    problems.push(
      `funnel has ${strategy.funnel.length} stages; give three or four.`,
    );
  const conversion = strategy.funnel.find(
    (stage) => stage.stage === "conversion",
  );
  const metric = strategy.objective?.metric;
  if (
    conversion &&
    metric &&
    conversion.metric.trim().toLowerCase() !== metric.trim().toLowerCase()
  )
    problems.push(
      `the conversion stage measures "${conversion.metric}"; make it the objective's metric, "${metric}".`,
    );
  const pieces = strategy.calendar.filter(
    (entry) => entry.status !== "skipped",
  );
  if (pieces.length > 0) {
    if (pieces.length < MIN_PIECES)
      problems.push(
        `calendar has ${pieces.length} pieces; plan at least ${MIN_PIECES} for four weeks.`,
      );
    const formats = new Set(
      pieces.map((entry) => `${entry.channel}/${entry.format}`),
    );
    if (formats.size < MIN_FORMATS)
      problems.push(
        `calendar uses ${formats.size} formats; use at least ${MIN_FORMATS}.`,
      );
    if (pieces.some((entry) => entry.draft))
      problems.push(
        "the plan holds drafts; leave them out, the daily run writes each piece.",
      );
  }
  return problems;
}

/**
 * Whether the plan sells what the business sells: Jev, a separate evaluation
 * model, reads the Brand Brain's main offer, the owner's goal and the plan's
 * headline parts. Plans once drifted to a side product whose name echoed the
 * goal ("More leads" turned into a lead-research plan). A failed check is no
 * finding, so the save never waits on it.
 */
export async function cmoPlanDrift(input: {
  strategy: CmoStrategy;
  brain: CmoBrandBrain;
  goals: string;
}): Promise<{ problem: string | null; costUsd: number }> {
  const { strategy, brain } = input;
  try {
    const { answers, costUsd } = await evaluateWithJev({
      state: {
        mainOffer: brain.reveal?.positioning ?? brain.summary,
        products: brain.products,
        ownerGoal: input.goals,
        plan: {
          summary: strategy.summary,
          offer: strategy.offer?.what,
          focus: strategy.focus?.segment,
          pillars: strategy.pillars,
        },
      },
      questions: {
        sellsMainOffer: {
          type: "boolean",
          instructions:
            "Does the plan sell the business's main offer, or the product or launch the owner named in their goal, rather than a narrower side product or feature? A word in the goal such as 'leads' is the result the owner wants, never the topic.",
        },
      },
      timeoutMs: 15_000,
    });
    const answer = answers.get("sellsMainOffer");
    const drifts = answer?.type === "boolean" && answer.probability < 0.5;
    return {
      problem: drifts
        ? `the plan drifts from the main offer ("${brain.reveal?.positioning ?? brain.summary}"); make the summary, offer, focus and pillars sell it, or the product the owner named.`
        : null,
      costUsd,
    };
  } catch {
    return { problem: null, costUsd: 0 };
  }
}
