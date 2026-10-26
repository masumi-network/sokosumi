/**
 * CMO regression lab: runs Cuso's research and strategy from scratch for a
 * set of real brands and checks each result against what the brand really
 * sells, plus the strategy skill's hard rules. Run it before changing Cuso's
 * skills, prompts or model: a rule that fixes one brand has broken others.
 *
 * pnpm --filter core cmo:lab -- --slots alice@sokosumi.test,bob@sokosumi.test
 * pnpm --filter core cmo:lab -- --slots alice@sokosumi.test --only cal.com,Hiltl
 *
 * Local database only: each slot is a local test account with a CMO hire,
 * and the lab rewrites that hire's business, Brand Brain and strategy.
 * Brands and their main offers: scripts/fixtures/cmo-lab-brands.json.
 */

import { readFile, writeFile } from "node:fs/promises";
import { Prisma } from "@sokosumi/database";
import type { CmoStrategy } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import {
  parseCmoBrandBrain,
  parseCmoStrategy,
  requestCmoStrategy,
  startCmoResearch,
} from "@/services/cmo.service";
import { cmoPlanProblems } from "@/services/cmo-plan-review.service";

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
    "The CMO lab rewrites hires: run it against a local database only.",
  );
}
if (slots.length === 0) {
  throw new Error(
    "Pass --slots with local test accounts that have a CMO hire.",
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

const ACTIVE = ["QUEUED", "STARTING", "RUNNING", "CANCEL_REQUESTED"];
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
  const hire = await prisma.cmoHire.update({
    where: { userId: user.id },
    data: {
      businessName: brand.name,
      websiteUrl: brand.url,
      goals: brand.goal,
      brandVisual: Prisma.DbNull,
      brandBrain: Prisma.DbNull,
      brandBrainUpdatedAt: null,
      strategy: Prisma.DbNull,
      strategyUpdatedAt: null,
      strategyApprovedAt: null,
      strategyHistory: Prisma.DbNull,
      accountsDoneAt: null,
    },
  });
  const research = await settle((await startCmoResearch(hire)).turnId);
  const plan =
    research === "COMPLETED"
      ? await settle((await requestCmoStrategy({ userId: user.id })).turnId)
      : "SKIPPED";
  const saved = await prisma.cmoHire.findUniqueOrThrow({
    where: { id: hire.id },
  });
  return { research, plan, ...judge(brand, saved) };
}

function judge(
  brand: Brand,
  saved: { brandBrain: unknown; strategy: unknown },
): { pass: boolean; findings: string[]; summary?: string; offer?: string } {
  const brain = parseCmoBrandBrain(saved.brandBrain);
  const strategy = parseCmoStrategy(saved.strategy) as CmoStrategy | null;
  const findings: string[] = [];
  if (!brain) findings.push("no Brand Brain");
  else if (!new RegExp(brand.brain ?? brand.main, "i").test(brain.summary))
    findings.push(
      `Brand Brain misses the main offer: ${brain.summary.slice(0, 140)}`,
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
    new RegExp(brand.avoid, "i").test(
      `${strategy.summary} ${strategy.offer?.what ?? ""}`,
    )
  )
    findings.push("the plan is about a side product");
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
    const result = settled[index] as { pass: boolean; findings: string[] };
    results.push({ brand: brand.name, why: brand.why, ...result });
    console.log(`${result.pass ? "PASS" : "FAIL"}  ${brand.name}`);
    for (const finding of result.findings) console.log(`      ${finding}`);
  });
}
const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed} of ${results.length} brands pass`);
await writeFile(out, JSON.stringify(results, null, 2));
await prisma.$disconnect();
