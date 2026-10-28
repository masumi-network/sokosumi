/**
 * CMO regression lab: runs Cuso's research and strategy from scratch for a
 * set of real brands and checks each result against what the brand really
 * sells, plus the strategy skill's hard rules. Run it before changing Cuso's
 * skills, prompts or model: a rule that fixes one brand has broken others.
 *
 * pnpm --filter core cmo:lab -- --slots alice@sokosumi.test,bob@sokosumi.test
 * pnpm --filter core cmo:lab -- --slots alice@sokosumi.test --only cal.com,Hiltl
 *
 * Local database only: each slot is a local test account that works with a
 * Cuso, and the lab rewrites his Project's website, Brand Brain and strategy.
 * Brands and their main offers: scripts/fixtures/cmo-lab-brands.json.
 */

import { readFile, writeFile } from "node:fs/promises";
import type { SokoBotTurnStatus } from "@sokosumi/database";
import type { CmoStrategy } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { parseCmoBrandBrain } from "@/services/brand-brain.service";
import { findCusoForUser } from "@/services/cmo-cuso.service";
import { startCmoResearch } from "@/services/cmo-hiring.service";
import { cmoPlanProblems } from "@/services/cmo-plan-review.service";
import { requestCmoStrategy } from "@/services/cmo-strategy.service";
import {
  newestMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";

interface Brand {
  name: string;
  url: string;
  goal: string;
  /** What the brand sells, as a pattern the plan's headline parts must match. */
  main: string;
  /** What the Brand Brain must name, when it differs from the plan (a launch). */
  brain?: string;
  /** A side product the plan must not be about. */
  avoid?: string;
  /** The language its posts must be written in. */
  contentLanguage?: string;
  /** Words the plan's summary uses when it must not be in English. */
  planLanguage?: string;
  /** A business with many product lines lists at least this many offers. */
  minOffers?: number;
  why?: string;
}

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
const slots = (flag("slots") ?? "").split(",").filter(Boolean);
const only = flag("only")
  ?.split(",")
  .map((name) => name.trim());
const out = flag("out") ?? "cmo-lab-results.json";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  throw new Error(
    "The CMO lab rewrites Cuso's Projects: run it against a local database only.",
  );
}
if (slots.length === 0) {
  throw new Error(
    "Pass --slots with local test accounts that work with a Cuso.",
  );
}

const brands = (
  JSON.parse(
    await readFile(
      new URL("./fixtures/cmo-lab-brands.json", import.meta.url),
      "utf8",
    ),
  ) as Brand[]
).filter((brand) => !only || only.includes(brand.name));

const ACTIVE: SokoBotTurnStatus[] = [
  "QUEUED",
  "STARTING",
  "RUNNING",
  "CANCEL_REQUESTED",
];
async function settle(turnId: string): Promise<string> {
  for (;;) {
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
      select: { status: true },
    });
    if (!ACTIVE.includes(turn.status)) return turn.status;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

async function run(email: string, brand: Brand) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const current = await findCusoForUser(user.id);
  if (!current) throw new Error(`${email} works with no Cuso`);
  // The website and the brand's look are the Project's.
  await prisma.project.update({
    where: { id: current.projectId },
    data: {
      websiteUrl: brand.url,
      designMdUrl: null,
      designMdExtractionId: null,
    },
  });
  // The Brand Brain is the Project's too.
  await prisma.brandBrain.deleteMany({
    where: { projectId: current.projectId },
  });
  // Read again: his website and business name are the Project's new ones.
  const hire = await findCusoForUser(user.id);
  if (!hire) throw new Error(`${email} works with no Cuso`);
  // Hiring progress is read from the data; only skipping accounts is stored.
  await prisma.user.update({
    where: { id: user.id },
    data: { cmoAccountsSkipped: false },
  });
  await prisma.marketingStrategy.deleteMany({
    where: { projectId: hire.projectId },
  });
  // A stopped lab run leaves its turns active, and they would block this one.
  await prisma.sokoBotTurn.updateMany({
    where: { sokoBotId: hire.sokoBotId, status: { in: ACTIVE } },
    data: {
      status: "FAILED",
      errorKind: "lab_run_stopped",
      completedAt: new Date(),
    },
  });
  // A lab run is many turns a day; the owner's daily brake would stop it.
  await prisma.sokoBot.update({
    where: { id: hire.sokoBotId },
    data: { proactiveDailyLimit: 1_000 },
  });
  const research = await settle((await startCmoResearch(hire, user.id)).turnId);
  const plan =
    research === "COMPLETED"
      ? await settle((await requestCmoStrategy({ userId: user.id })).turnId)
      : "SKIPPED";
  const [brain, strategy] = await Promise.all([
    prisma.brandBrain.findUnique({ where: { projectId: hire.projectId } }),
    newestMarketingStrategy(hire.projectId),
  ]);
  return {
    research,
    plan,
    ...judge(brand, { brandBrain: brain?.body, strategy: strategy?.plan }),
  };
}

function judge(
  brand: Brand,
  saved: { brandBrain: unknown; strategy: unknown },
): { pass: boolean; findings: string[]; summary?: string; offer?: string } {
  const brain = parseCmoBrandBrain(saved.brandBrain);
  const strategy = parseMarketingPlan(saved.strategy) as CmoStrategy | null;
  const findings: string[] = [];
  if (!brain) findings.push("no Brand Brain");
  else if (!new RegExp(brand.brain ?? brand.main, "i").test(brain.summary))
    findings.push(
      `Brand Brain misses the main offer: ${brain.summary.slice(0, 140)}`,
    );
  if (brain && brand.minOffers && brain.offers.length < brand.minOffers)
    findings.push(
      `Brand Brain lists ${brain.offers.length} offers, not every product line: ${brain.offers.map((offer) => offer.name).join(", ")}`,
    );
  if (!strategy) return { pass: false, findings: [...findings, "no strategy"] };
  const head = [
    strategy.summary,
    strategy.offer?.what ?? "",
    ...strategy.pillars,
  ].join(" ");
  if (!new RegExp(brand.main, "i").test(head))
    findings.push("the plan does not sell the main offer");
  if (
    brand.avoid &&
    // What the plan sells; the summary may name the side product as one part.
    new RegExp(brand.avoid, "i").test(strategy.offer?.what ?? "")
  )
    findings.push(`the plan sells a side product: ${strategy.offer?.what}`);
  if (
    brand.contentLanguage &&
    !new RegExp(brand.contentLanguage, "i").test(strategy.contentLanguage ?? "")
  )
    findings.push(
      `posts in "${strategy.contentLanguage ?? "no language"}", not ${brand.contentLanguage}`,
    );
  if (
    brand.planLanguage &&
    !new RegExp(brand.planLanguage, "i").test(strategy.summary)
  )
    findings.push("the plan is not in the owner's language");
  findings.push(...cmoPlanProblems(strategy));
  return {
    pass: findings.length === 0,
    findings,
    summary: strategy.summary,
    offer: strategy.offer?.what,
  };
}

const results: Record<string, unknown>[] = [];
for (let start = 0; start < brands.length; start += slots.length) {
  const batch = brands.slice(start, start + slots.length);
  const settled = await Promise.all(
    batch.map((brand, index) =>
      run(slots[index] as string, brand).catch((error: unknown) => ({
        research: "ERROR",
        plan: "ERROR",
        pass: false,
        findings: [error instanceof Error ? error.message : String(error)],
      })),
    ),
  );
  batch.forEach((brand, index) => {
    const result = settled[index] as {
      pass: boolean;
      findings: string[];
      research: string;
      plan: string;
    };
    results.push({ brand: brand.name, why: brand.why, ...result });
    console.log(
      `${result.pass ? "PASS" : "FAIL"}  ${brand.name}  (research ${result.research}, plan ${result.plan})`,
    );
    for (const finding of result.findings) console.log(`      ${finding}`);
  });
}
const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed} of ${results.length} brands pass`);
await writeFile(out, JSON.stringify(results, null, 2));
await prisma.$disconnect();
