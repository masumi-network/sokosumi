import type {
  BrandBrain,
  MarketingStrategyPlan,
  ScenarioCheck,
} from "@sokosumi/soko-bot";
import { parseBrandBrain } from "@/services/brand-brain.service";
import {
  CMO_LIVE_NETWORKS,
  cmoFunnelPlanProblems,
  cmoLeftOutProblems,
  cmoPlanProblems,
  cmoPlanRuleProblems,
  cmoTopVolumeProblems,
  type PlanReviewOptions,
} from "@/services/cmo-plan-review.service";
import { parseMarketingPlan } from "@/services/marketing-strategy.service";
import type { CmoEvalBrand } from "./eval-cmo-cases";

/**
 * What a Brand Brain and a month's plan must get right for a real brand: it
 * sells what the brand sells, not a side product, in the owner's language,
 * and keeps the strategy skill's hard rules. The CMO lab and the CMO eval
 * cases check the same things.
 */
export function brandBrainChecks(
  brand: CmoEvalBrand,
  body: unknown,
): { brain: BrandBrain | null; checks: ScenarioCheck[] } {
  const brain = parseBrandBrain(body);
  if (!brain)
    return {
      brain,
      checks: [{ label: "Brand Brain saved", pass: false, actual: "none" }],
    };
  const checks: ScenarioCheck[] = [
    { label: "Brand Brain saved", pass: true, actual: "saved" },
    {
      label: "Brand Brain names the main offer",
      pass: new RegExp(brand.brain ?? brand.main, "i").test(brain.summary),
      actual: brain.summary.slice(0, 200),
    },
  ];
  if (brand.minOffers)
    checks.push({
      label: `Lists at least ${brand.minOffers} offers`,
      pass: brain.offers.length >= brand.minOffers,
      actual: brain.offers.map((offer) => offer.name).join(", "),
    });
  if (brand.price)
    checks.push({
      label: "Prices the main offer as published",
      pass: new RegExp(brand.price, "i").test(brain.offers[0]?.price ?? ""),
      actual: brain.offers[0]?.price ?? "no offer",
    });
  if (brand.profile)
    checks.push({
      label: "Lists its social profile",
      pass: brain.channels.some((channel) =>
        new RegExp(brand.profile ?? "", "i").test(channel.url ?? ""),
      ),
      actual: brain.channels
        .map((channel) => channel.url ?? channel.name)
        .join(", "),
    });
  return { brain, checks };
}

/**
 * The share of calendar titles that must carry a word of the posts' language.
 * A short title carries none ("Hiltl Tartare, frisch serviert"): German
 * calendars scored 72 to 92 in a hundred, an English one none.
 */
const PIECE_LANGUAGE_SHARE = 0.4;

export function strategyChecks(
  brand: CmoEvalBrand,
  saved: unknown,
  options: PlanReviewOptions = {},
): { strategy: MarketingStrategyPlan | null; checks: ScenarioCheck[] } {
  const strategy = parseMarketingPlan(saved) as MarketingStrategyPlan | null;
  if (!strategy)
    return {
      strategy,
      checks: [{ label: "Strategy saved", pass: false, actual: "none" }],
    };
  // The core offer, the summary, the entry offer and the pillars: what the
  // plan sells. Its positioning names the category whatever it sells.
  const head = [
    strategy.ladder?.core.what ?? "",
    strategy.summary,
    strategy.offer?.what ?? "",
    ...strategy.pillars.map((pillar) => pillar.name),
  ].join(" ");
  const checks: ScenarioCheck[] = [
    { label: "Strategy saved", pass: true, actual: "saved" },
    {
      label: "Sells the main offer",
      pass: new RegExp(brand.main, "i").test(head),
      actual:
        `Core: ${strategy.ladder?.core.what ?? "missing"}; entry: ${strategy.offer?.what ?? "missing"}; headline: ${head}`.slice(
          0,
          600,
        ),
    },
  ];
  if (brand.avoid)
    checks.push({
      label: "Does not sell a side product",
      // What the plan sells; the summary may name the side product as one part.
      pass: !new RegExp(brand.avoid, "i").test(
        [strategy.ladder?.core.what ?? "", strategy.offer?.what ?? ""].join(
          " ",
        ),
      ),
      actual: `Core: ${strategy.ladder?.core.what ?? "missing"}; entry: ${strategy.offer?.what ?? "missing"}`,
    });
  if (brand.contentLanguage)
    checks.push({
      label: `Posts in ${brand.contentLanguage}`,
      pass: new RegExp(brand.contentLanguage, "i").test(
        strategy.contentLanguage ?? "",
      ),
      actual: strategy.contentLanguage ?? "no language",
    });
  if (brand.planLanguage)
    checks.push({
      label: "Strategy in the owner's language",
      pass: new RegExp(brand.planLanguage, "i").test(strategy.summary),
      actual: strategy.summary.slice(0, 200),
    });
  if (brand.pieceLanguage) {
    const pieces = new RegExp(brand.pieceLanguage, "i");
    const titles = strategy.calendar.map((entry) => entry.title);
    const other = titles.filter((title) => !pieces.test(title));
    checks.push({
      label: "Calendar titles in the posts' language",
      pass:
        titles.length > 0 &&
        other.length <= titles.length * (1 - PIECE_LANGUAGE_SHARE),
      actual: `${titles.length - other.length} of ${titles.length} titles${other.length ? `; not: ${other.slice(0, 4).join(" · ")}` : ""}`,
    });
  }
  if (brand.websiteOnly) checks.push(...websiteOnlyChecks(strategy));
  // cmo-v8's claims are compared by meaning: the runner checks them.
  if (brand.focus && brand.focus !== "claims")
    checks.push(focusCheck(brand.focus, strategy));
  if (options.everyNetwork) checks.push(firstStrategyAdsCheck(strategy));
  const problems = [
    ...cmoPlanRuleProblems(strategy),
    ...cmoPlanProblems(strategy, options),
  ];
  checks.push({
    label: "Keeps the strategy skill's rules",
    pass: problems.length === 0,
    actual: problems.length ? problems.join(" · ") : "no problems",
  });
  return { strategy, checks };
}

/** Failed checks as the lab's findings list. */
/**
 * A business with no profile anywhere: every live network is planned or left
 * out with a reason, and each planned one says the owner opens the account.
 */
function websiteOnlyChecks(strategy: MarketingStrategyPlan): ScenarioCheck[] {
  const planned = strategy.channels.filter((channel) =>
    CMO_LIVE_NETWORKS.includes(channel.channel.toLowerCase()),
  );
  const leftOut = (strategy.leftOut ?? []).map((item) => item.channel);
  const missing = CMO_LIVE_NETWORKS.filter(
    (network) =>
      !planned.some((channel) => channel.channel.toLowerCase() === network) &&
      !leftOut.includes(network),
  );
  const notNew = planned.filter((channel) => !/^new:/i.test(channel.why ?? ""));
  const proposed = strategy.proposals
    .map((proposal) => proposal.channel)
    .filter((channel) => CMO_LIVE_NETWORKS.includes(channel));
  return [
    {
      label: "Every live network is planned or left out with a reason",
      pass: missing.length === 0 && planned.length >= 3,
      actual: `planned: ${planned.map((channel) => channel.channel).join(", ") || "none"}; left out: ${leftOut.join(", ") || "none"}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`,
    },
    {
      label: "Each planned network says the owner opens the account",
      pass: notNew.length === 0,
      actual: notNew.length
        ? `no "New:" on ${notNew.map((channel) => channel.channel).join(", ")}`
        : "all new",
    },
    {
      label: "No social network is parked in proposals",
      pass: proposed.length === 0,
      actual: proposed.join(", ") || "none",
    },
  ];
}

/**
 * One promise of cmo-v5's strategy, checked on its own: the top volume
 * whatever pays for Cuso, a funnel in the plan's own numbers, and YouTube and
 * TikTok fed by the month's talking videos. NMKR's month broke all three.
 */
function focusCheck(
  focus: Exclude<CmoEvalBrand["focus"], "claims" | undefined>,
  strategy: MarketingStrategyPlan,
): ScenarioCheck {
  if (focus === "top-volume") {
    const problems = cmoTopVolumeProblems(strategy);
    return {
      label: "Writes the month at the top volume",
      pass: problems.length === 0,
      actual:
        problems.join(" · ") ||
        `${strategy.pace?.level}, ${strategy.channels.map((channel) => `${channel.channel} ${channel.cadence}`).join(", ")}`,
    };
  }
  if (focus === "funnel-plan") {
    const problems = cmoFunnelPlanProblems(strategy);
    return {
      label: "The funnel says what the channels and calendar hold",
      pass: strategy.funnel.length > 0 && problems.length === 0,
      actual: problems.join(" · ") || "matches",
    };
  }
  const missing = ["youtube", "tiktok"].filter(
    (network) =>
      !strategy.channels.some((channel) => channel.channel === network) ||
      !strategy.calendar.some(
        (entry) =>
          entry.format === "talking_video" &&
          entry.status !== "skipped" &&
          (entry.channel === network || entry.alsoOn?.includes(network)),
      ),
  );
  return {
    label: "Plans YouTube and TikTok with the month's talking videos",
    pass: missing.length === 0 && cmoLeftOutProblems(strategy).length === 0,
    actual: missing.length
      ? `missing ${missing.join(", ")}; left out: ${(strategy.leftOut ?? []).map((item) => `${item.channel} (${item.why})`).join(", ") || "none"}`
      : "both planned",
  };
}

/** A first strategy plans no ads: they wait for the owner's yes. */
function firstStrategyAdsCheck(strategy: MarketingStrategyPlan): ScenarioCheck {
  const ads = ["google_ads", "meta_ads"];
  const planned = [
    ...strategy.channels
      .filter((channel) => ads.includes(channel.channel))
      .map((channel) => `channel ${channel.channel}`),
    ...strategy.calendar
      .filter(
        (entry) => ads.includes(entry.channel) && entry.status !== "skipped",
      )
      .map((entry) => `piece ${entry.id}`),
    ...strategy.questions
      .filter((question) =>
        /\bads?\b|advertis|ad budget/i.test(question.question),
      )
      .map((question) => `question "${question.question}"`),
  ];
  return {
    label: "Plans no ads and asks nothing about them before the owner's yes",
    pass: planned.length === 0 && (strategy.ads?.monthly ?? 0) === 0,
    actual:
      planned.slice(0, 5).join(" · ") ||
      (strategy.ads?.monthly
        ? `monthly ${strategy.ads.monthly}`
        : `no ads; would start with ${strategy.ads?.suggest ? `${strategy.ads.suggest.channel} at ${strategy.ads.suggest.monthly}` : "nothing"}`),
  };
}

export function findings(checks: readonly ScenarioCheck[]): string[] {
  return checks
    .filter((check) => !check.pass)
    .map((check) => `${check.label}: ${check.actual}`);
}
