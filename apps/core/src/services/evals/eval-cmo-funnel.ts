import {
  CMO_AIDA_STAGES,
  type MarketingStrategyPlan,
  type ScenarioCheck,
} from "@sokosumi/soko-bot";

import type { EvalLaneRecord } from "@/services/evals/eval-lanes.service";
import {
  newestMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";

/** The owner asks for the funnel in the classic stages, on a month Cuso wrote before them. */
export const CMO_FUNNEL_CASE_ID = "cmo-funnel-aida";

/** The saved funnel after the turn: AIDA's four stages, each with Cuso's part. */
export async function funnelChecks(
  lane: EvalLaneRecord,
): Promise<ScenarioCheck[]> {
  const saved = await newestMarketingStrategy(lane.cusoProjectId);
  const plan = parseMarketingPlan(saved?.plan) as MarketingStrategyPlan | null;
  const funnel = plan?.funnel ?? [];
  const stages = funnel.map((stage) => stage.stage);
  const silent = funnel.filter((stage) => !stage.cusoDoes);
  const named = funnel.filter((stage) => stage.name);
  return [
    {
      label: "Funnel is Awareness, Interest, Desire, Action, in that order",
      pass: stages.join() === CMO_AIDA_STAGES.join(),
      actual: stages.join(", ") || "no funnel",
    },
    {
      label: "Every stage says what Cuso does",
      pass: funnel.length > 0 && silent.length === 0,
      actual: silent.length
        ? `missing on ${silent.map((stage) => stage.stage).join(", ")}`
        : `${funnel.length} stages`,
    },
    {
      label: "No stage carries a name of Cuso's own",
      pass: named.length === 0,
      actual: named.map((stage) => stage.name).join(" · ") || "none",
    },
  ];
}
