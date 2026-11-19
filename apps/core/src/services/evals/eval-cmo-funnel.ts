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

/** The monthly ad budget the owner sets in the ads case, in USD. */
export const ADS_CASE_BUDGET = 600;

/** The owner said yes to ads and set a budget; Cuso plans the ads around it. */
export const CMO_ADS_CASE_ID = "cmo-ads-yes";

const AD_CHANNELS = ["google_ads", "meta_ads"];

/** The saved strategy after the turn: ads planned at the owner's amount, and in the funnel. */
export async function adsChecks(
  lane: EvalLaneRecord,
): Promise<ScenarioCheck[]> {
  const saved = await newestMarketingStrategy(lane.cusoProjectId);
  const plan = parseMarketingPlan(saved?.plan) as MarketingStrategyPlan | null;
  const channels = (plan?.channels ?? [])
    .map((channel) => channel.channel)
    .filter((channel) => AD_CHANNELS.includes(channel));
  const ads = (plan?.calendar ?? []).filter(
    (entry) =>
      AD_CHANNELS.includes(entry.channel) && entry.status !== "skipped",
  );
  const stages = (plan?.funnel ?? []).filter((stage) =>
    stage.plays.some((play) => AD_CHANNELS.includes(play.channel)),
  );
  return [
    {
      label: "Keeps the owner's ad budget",
      pass:
        plan?.ads?.monthly === ADS_CASE_BUDGET && plan.ads.setByOwner === true,
      actual: plan?.ads
        ? `${plan.ads.currency} ${plan.ads.monthly}${plan.ads.setByOwner ? "" : ", no longer the owner's"}`
        : "no ads",
    },
    {
      label: "Plans an ads channel with ads in the calendar",
      pass: channels.length > 0 && ads.length >= 2,
      actual: `channels: ${channels.join(", ") || "none"}; ${ads.length} ads`,
    },
    {
      label: "Shows the ads in the funnel",
      pass: stages.length > 0,
      actual: stages.map((stage) => stage.stage).join(", ") || "no stage",
    },
  ];
}
