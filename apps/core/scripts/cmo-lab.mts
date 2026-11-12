/**
 * CMO regression lab: runs Cuso's research and strategy from scratch for a
 * set of real brands and checks each result against what the brand really
 * sells, plus the strategy skill's hard rules. Run it before changing Cuso's
 * skills, prompts or model: a rule that fixes one brand has broken others.
 *
 * pnpm --filter core cmo:lab -- --slots alice@sokosumi.test,bob@sokosumi.test
 * pnpm --filter core cmo:lab -- --slots alice@sokosumi.test --only cal.com,Hiltl
 * pnpm --filter core cmo:lab -- --slots alice@sokosumi.test --only Linear --make
 *
 * --make also approves each plan and waits while Core makes the month and
 * Jev reviews it (hours; run Core's syncs meanwhile), then reports what Jev
 * flagged before and after the rewrite run.
 *
 * Local database only: each slot is a local test account that works with a
 * Cuso, and the lab rewrites his Project's website, Brand Brain and strategy.
 * Brands and their main offers: src/services/evals/fixtures/cmo-brands.json,
 * which the CMO eval cases use too.
 */

import { writeFile } from "node:fs/promises";
import type { SokoBotTurnStatus } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import {
  findCusoForProject,
  listCusosForUser,
  startCmoProductionForProject,
} from "@/services/cmo-cuso.service";
import { startCmoResearch } from "@/services/cmo-hiring.service";
import { parseCmoMonthReview } from "@/services/cmo-month-review.service";
import { requestCmoStrategy } from "@/services/cmo-strategy.service";
import {
  brandBrainChecks,
  findings,
  strategyChecks,
} from "@/services/evals/cmo-brand-checks";
import {
  CMO_EVAL_BRANDS,
  type CmoEvalBrand,
} from "@/services/evals/eval-cmo-cases";
import {
  approveMarketingStrategy,
  newestMarketingStrategy,
} from "@/services/marketing-strategy.service";

type Brand = CmoEvalBrand;

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
const make = args.includes("--make");
/** How long --make waits for a month to be made and reviewed. */
const MAKE_DEADLINE_MS = 5 * 60 * 60_000;

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

const brands = CMO_EVAL_BRANDS.filter(
  (brand) => !only || only.includes(brand.name),
);

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
  // The lab account's newest Cuso.
  const [current] = await listCusosForUser(user.id);
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
  const cuso = await findCusoForProject({
    userId: user.id,
    projectId: current.projectId,
  });
  if (!cuso) throw new Error(`${email} works with no Cuso`);
  // Hiring progress is read from the data; CMO's screen choices live in its cookie.
  await prisma.marketingStrategy.deleteMany({
    where: { projectId: cuso.projectId },
  });
  // A stopped lab run leaves its turns active, and they would block this one.
  await prisma.sokoBotTurn.updateMany({
    where: { sokoBotId: cuso.sokoBotId, status: { in: ACTIVE } },
    data: {
      status: "FAILED",
      errorKind: "lab_run_stopped",
      completedAt: new Date(),
    },
  });
  // An earlier month's production runs would count against today's cap.
  await prisma.sokoBotTurn.updateMany({
    where: {
      sokoBotId: cuso.sokoBotId,
      clientTurnId: { startsWith: "cmo:production:" },
      createdAt: { gt: new Date(Date.now() - 24 * 60 * 60_000) },
    },
    data: { createdAt: new Date(Date.now() - 25 * 60 * 60_000) },
  });
  // A lab run is many turns a day; the owner's daily brake would stop it.
  await prisma.sokoBot.update({
    where: { id: cuso.sokoBotId },
    data: { proactiveDailyLimit: 1_000 },
  });
  const research = await settle((await startCmoResearch(cuso, user.id)).turnId);
  const plan =
    research === "COMPLETED"
      ? await settle(
          (
            await requestCmoStrategy({
              userId: user.id,
              projectId: cuso.projectId,
            })
          ).turnId,
        )
      : "SKIPPED";
  const [brain, strategy] = await Promise.all([
    prisma.brandBrain.findUnique({ where: { projectId: cuso.projectId } }),
    newestMarketingStrategy(cuso.projectId),
  ]);
  const made =
    make && plan === "COMPLETED" && strategy
      ? await makeMonth(user.id, cuso, strategy.id)
      : undefined;
  return {
    research,
    plan,
    ...judge(brand, { brandBrain: brain?.body, strategy: strategy?.plan }),
    ...(made ? { made } : {}),
  };
}

/** Jev's flags of one review round: pieces read, pieces flagged, the rules missed. */
function flags(review: ReturnType<typeof parseCmoMonthReview>) {
  const reads = Object.values(review?.writing ?? {});
  const rules: Record<string, number> = {};
  for (const read of reads)
    for (const rule of [
      ...read.missed,
      ...read.problems,
      ...(read.soundsLikeBrand ? [] : ["brand voice"]),
    ])
      rules[rule] = (rules[rule] ?? 0) + 1;
  return {
    read: reads.length,
    flagged: reads.filter(
      (read) =>
        !read.followsSkill || !read.soundsLikeBrand || read.problems.length > 0,
    ).length,
    rules: Object.fromEntries(
      Object.entries(rules).sort((left, right) => right[1] - left[1]),
    ),
  };
}

/** Approves the plan and waits for the made month's review, both rounds. */
async function makeMonth(
  userId: string,
  cuso: { projectId: string; workspaceId: string },
  strategyId: string,
) {
  await approveMarketingStrategy({
    projectId: cuso.projectId,
    workspaceId: cuso.workspaceId,
    userId,
    strategyId,
  });
  await startCmoProductionForProject(cuso.projectId);
  const deadline = Date.now() + MAKE_DEADLINE_MS;
  let first: ReturnType<typeof flags> | undefined;
  for (;;) {
    const version = await prisma.marketingStrategy.findUniqueOrThrow({
      where: { id: strategyId },
      select: { monthReview: true },
    });
    const review = parseCmoMonthReview(version.monthReview);
    if (review?.round === 1) first ??= flags(review);
    const done = review && (review.round === 2 || !review.rewriteRunId);
    if (done || Date.now() > deadline) {
      const posts = await prisma.socialPost.findMany({
        where: { marketingStrategyId: strategyId, status: { not: "CANCELED" } },
        select: { text: true, planning: true },
      });
      const written = posts.filter((post) => {
        const planning = post.planning as { brief?: unknown; title?: unknown };
        return post.text !== planning?.brief && post.text !== planning?.title;
      });
      return {
        finished: Boolean(done),
        posts: `${written.length} of ${posts.length} written`,
        first: first ?? flags(review),
        last: review?.round === 2 ? flags(review) : undefined,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

function judge(
  brand: Brand,
  saved: { brandBrain: unknown; strategy: unknown },
): {
  pass: boolean;
  findings: string[];
  summary?: string;
  offer?: string;
  read?: Record<string, unknown>;
} {
  const learned = brandBrainChecks(brand, saved.brandBrain);
  const planned = strategyChecks(brand, saved.strategy);
  const failed = findings([...learned.checks, ...planned.checks]);
  const brain = learned.brain;
  const strategy = planned.strategy;
  if (!strategy) return { pass: false, findings: failed };
  const pieces = strategy.calendar.filter(
    (entry) => entry.status !== "skipped",
  );
  return {
    pass: failed.length === 0,
    findings: failed,
    summary: strategy.summary,
    offer: strategy.offer?.what,
    read: {
      customerQuotes: brain?.voiceOfCustomer?.length ?? 0,
      competitorsRead:
        brain?.competitors.filter((rival) => rival.promise || rival.price)
          .length ?? 0,
      linkedinStories: `${pieces.filter((entry) => entry.channel === "linkedin" && entry.story).length} of ${pieces.filter((entry) => entry.channel === "linkedin").length}`,
      comparison: pieces
        .filter((entry) =>
          /\b(vs\.?|versus|alternatives?)\b/i.test(entry.title),
        )
        .map((entry) => entry.title),
      sourceOfTruth: strategy.measurement?.sourceOfTruth,
      experiment: strategy.measurement?.experiment?.change,
    },
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
    const extra = result as { read?: unknown; made?: unknown };
    if (extra.read) console.log(`      read: ${JSON.stringify(extra.read)}`);
    if (extra.made) console.log(`      made: ${JSON.stringify(extra.made)}`);
  });
}
const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed} of ${results.length} brands pass`);
await writeFile(out, JSON.stringify(results, null, 2));
await prisma.$disconnect();
