import type {
  BrandBrain,
  MarketingStrategyPlan,
  ScenarioCheck,
} from "@sokosumi/soko-bot";
import { parseBrandBrain } from "@/services/brand-brain.service";
import { cmoPlanProblems } from "@/services/cmo-plan-review.service";
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
  return { brain, checks };
}

export function strategyChecks(
  brand: CmoEvalBrand,
  saved: unknown,
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
      label: "Plan in the owner's language",
      pass: new RegExp(brand.planLanguage, "i").test(strategy.summary),
      actual: strategy.summary.slice(0, 200),
    });
  const problems = cmoPlanProblems(strategy);
  checks.push({
    label: "Keeps the strategy skill's rules",
    pass: problems.length === 0,
    actual: problems.length ? problems.join(" · ") : "no problems",
  });
  return { strategy, checks };
}

/** Failed checks as the lab's findings list. */
export function findings(checks: readonly ScenarioCheck[]): string[] {
  return checks
    .filter((check) => !check.pass)
    .map((check) => `${check.label}: ${check.actual}`);
}
