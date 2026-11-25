import type { Prisma } from "@sokosumi/database";
import {
  type BrandBrain,
  type CmoCalendarEntry,
  type CmoMonthWriter,
  cmoCalendarEntrySchema,
  type MarketingStrategyPlan,
} from "@sokosumi/soko-bot";
import {
  type CmoVolumeLevel,
  cmoMonthFloor,
  cmoVolumeLevelForTier,
} from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import { generateText, Output } from "ai";
import { z } from "zod";
import { jsonInput } from "@/helpers/prisma-json";
import { rethrowAiGatewayFailure } from "@/lib/ai-gateway-budget";
import prisma from "@/lib/db/prisma";
import { isEvalCusoProject } from "@/lib/evals/eval-guard";
import {
  createCoreLogger,
  emitCoreError,
  emitCoreWarning,
  runAsBackgroundWork,
} from "@/lib/evlog";
import { findRepeats } from "@/lib/repeats";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { gatewayCallUsage, gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";
import { sokoBotModelRequest } from "@/lib/soko-bot/model-policy";
import {
  compactBrandBrain,
  getBrandBrain,
  parseBrandBrain,
} from "@/services/brand-brain.service";
import { cmoPaidFor } from "@/services/cmo-billing.service";
import type { Cuso } from "@/services/cmo-cuso.service";
import {
  type CmoIndustryResearch,
  cmoIndustryLine,
  readCmoIndustry,
} from "@/services/cmo-industry.service";
import {
  CMO_MONTH_DAYS,
  type CmoMonthSlot,
  cmoMonthChunks,
  cmoPlanMonthSlots,
  cmoSlotNetworks,
} from "@/services/cmo-month-slots";
import {
  mixProblems,
  pillarProblems,
} from "@/services/cmo-plan-review.service";
import {
  parseMarketingPlan,
  planMarketingStrategyPosts,
} from "@/services/marketing-strategy.service";
import { recordSokoBotCheckUsage } from "@/services/soko-bot-billing.service";

/**
 * Core writes a cmo-v22 month's calendar once the owner has paid (owner,
 * 2026-11-25): the strategy before payment is the plan and a few example
 * posts, and after it every post of the month is planned here, sized to the
 * plan bought. Core decides each post's day, network, format, pillar,
 * approach and funnel step (`cmo-month-slots.ts`), so the pillars and the
 * mix hold by construction; the strong model writes what each post says,
 * one network's week a call, every call at once. The examples stay as they
 * are. Production then makes the posts as for any approved month.
 */

/** The strong model (owner, 2026-11-25: never Haiku or Sonnet for this). */
export const CMO_MONTH_CALENDAR_MODEL = "openai/gpt-6.2-sol";
const PRICE = { input: 2 / 1e6, output: 10 / 1e6 };
/** Posts one call writes: a network's week, two calls for X at the top plan. */
const SLOTS_PER_CHUNK = 24;
/** Calls at once; the rest queue behind them. */
const CONCURRENT_CHUNKS = 8;
const MODEL_TIMEOUT_MS = 150_000;
/** Tries a chunk gets within one write. */
const CHUNK_TRIES = 2;
/** Rounds that rewrite the posts that repeat another post. */
const REPAIR_ROUNDS = 2;
/** A claim may carry this many posts of a month (the strategy skill's rule). */
const MAX_CLAIM_POSTS = 3;
/** A write that has not ended after this long crashed, and is tried again. */
export const CMO_MONTH_CALENDAR_STALE_MS = 15 * 60_000;
/** Writes that may end short before Core waits between tries and says so. */
export const CMO_MONTH_CALENDAR_ATTEMPTS = 3;
/** How long Core waits after its tries ran out, before the next. */
export const CMO_MONTH_CALENDAR_RETRY_MS = 3 * 60 * 60_000;

const DAY_MS = 86_400_000;

const writtenSchema = z.object({
  posts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      brief: z.string(),
      why: z.string(),
      claim: z.string(),
      story: z.string().nullable(),
    }),
  ),
});
type Written = z.infer<typeof writtenSchema>["posts"][number];

const DASH = /\s*[—–]\s*/g;
const clean = (text: string, max: number) =>
  text.replace(DASH, ", ").replace(/\s+/g, " ").trim().slice(0, max);

/** The month's first day: the examples' first day, never before tomorrow. */
export function cmoMonthStart(
  plan: Pick<MarketingStrategyPlan, "calendar">,
  now: Date,
): string {
  const tomorrow = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
  const first = plan.calendar
    .filter((entry) => entry.status !== "skipped")
    .map((entry) => entry.date)
    .sort()[0];
  return first && first > tomorrow ? first : tomorrow;
}

/**
 * What each pillar's posts build on, in turn: the research items its why
 * names (cmo-v21 pillars rest on them), else the items of the research
 * topic it is named after, else none.
 */
export function cmoPillarSeeds(
  plan: Pick<MarketingStrategyPlan, "pillars">,
  research: Pick<CmoIndustryResearch, "items" | "topics"> | null,
): Map<string, string[]> {
  const seeds = new Map<string, string[]>();
  if (!research) return seeds;
  const items = new Map(research.items.map((item) => [item.id, item]));
  for (const pillar of plan.pillars) {
    const named = [...(pillar.why ?? "").matchAll(/\bi\d+\b/g)].map(
      (match) => match[0],
    );
    const topic = research.topics.find(
      (item) =>
        item.name.trim().toLowerCase() === pillar.name.trim().toLowerCase(),
    );
    const ids = named.length > 0 ? named : (topic?.itemIds ?? []);
    const lines = ids.flatMap((id) => {
      const item = items.get(id);
      return item ? [`${item.id}: ${item.point}`] : [];
    });
    if (lines.length > 0) seeds.set(pillar.name, lines);
  }
  return seeds;
}

/** The brief every call of one month shares word for word, so it is cached. */
export function cmoMonthCalendarSystem(input: {
  businessName: string;
  websiteUrl: string;
  plan: MarketingStrategyPlan;
  brain: BrandBrain | null;
  proof: readonly string[];
  industry: readonly string[];
}): string {
  const { plan } = input;
  const examples = plan.calendar.filter((entry) => entry.status !== "skipped");
  const channels = plan.channels.map(
    (channel) =>
      `- ${channel.channel}${channel.role === "side" ? ` (side network for ${channel.buyer ?? "another buyer"})` : ""}: ${channel.why ?? ""}`,
  );
  return [
    `You plan posts of ${input.businessName}'s month of marketing (${input.websiteUrl}), as its marketer Cuso. The strategy below is approved and paid for. Core has already decided each post's day, network, format, content pillar, approach and funnel step; you write what each post says: its title, brief, why, claim and, for a social-proof post, story. Another call writes the other networks and weeks at the same time from this same brief, so give each post its own point from its own material.`,
    "Rules:",
    `- Titles, briefs, claims and stories are in ${plan.contentLanguage ?? "the language of the website"}; why is in English, plain words for an owner who is not a marketer.`,
    '- title: at most eight words, saying the post\'s own point ("The fee calculator in three clicks", never "Fees explained"). No two posts say one thing in other words, in this call or against the titles listed below.',
    '- brief: one or two lines on what the post says and shows, specific to this business, naming its material: the research item\'s id ("i4") when it rests on one, a product, price, customer or step from the Brand Brain otherwise.',
    "- why: one line, which goal or pillar it serves.",
    "- claim: the one sentence the post argues, a point a reader can agree or disagree with, never a topic or the title again.",
    "- story: only for a social-proof post, the one real moment it tells from the proof below, with names and numbers; null otherwise. Never invent a customer, a number, a result or a quote.",
    "- Industry facts (a number, a trend, news, a competitor's move) come only from the research below, by its id. Product facts (features, prices, plans, customers) come only from the Brand Brain.",
    "- The pillar decides what the post is about, the approach how it helps (educational helps buyers with their own work; product-led shows the product doing one job; social-proof tells a customer's result; promotional sends people to the offer's action), the stage what it does for the business (awareness: the right people find out it exists; interest: they look at what it does; desire: they want it from proof; action: they take the offer).",
    '- A post named "Build on" in its line rests on that material.',
    "- A short video (tiktok video, instagram reel, youtube short) shows something that moves: a product in use, a before and after, a screen changing, one step of a how-to. A talking video is a person explaining one idea to camera.",
    "- A side network's posts are for its buyer.",
    "- No em dashes, no hashtags, no emoji, no hype words.",
    "Strategy:",
    JSON.stringify({
      idea: plan.idea,
      summary: plan.summary,
      audience: plan.audience,
      positioning: plan.positioning,
      offer: plan.offer,
      focus: plan.focus,
      pillars: plan.pillars,
      mix: plan.mix,
      funnel: plan.funnel.map((stage) => ({
        stage: stage.stage,
        goal: stage.goal,
        cusoDoes: stage.cusoDoes,
      })),
    }),
    "Networks:",
    ...channels,
    "The strategy's example posts, the bar for every post (they stay in the month as they are):",
    ...examples.map(
      (entry) =>
        `- ${entry.channel}/${entry.format} · ${entry.pillar ?? ""} · ${entry.title}${entry.brief ? ` · ${entry.brief}` : ""}`,
    ),
    input.proof.length > 0
      ? [
          "Proof you may name, word for word (each in at most two posts of the month):",
          ...input.proof.map((point) => `- ${point}`),
        ].join("\n")
      : "The Brand Brain names no customer proof: no post tells a customer story.",
    input.industry.length > 0
      ? [
          "The buyers' industry (id · kind · date · point · source):",
          ...input.industry.map((line) => `- ${line}`),
        ].join("\n")
      : "",
    "Brand Brain:",
    JSON.stringify(compactBrandBrain(input.brain)),
  ]
    .filter((line) => line !== "")
    .join("\n\n");
}

/** One call's posts, one line each, with what it must not repeat. */
export function cmoMonthChunkPrompt(
  slots: readonly CmoMonthSlot[],
  avoid: readonly string[],
  /** A repair: what each post repeated, and the points already spent. */
  repair?: { repeated: ReadonlyMap<string, string>; spent: readonly string[] },
): string {
  return [
    `Write these ${slots.length} posts. Answer every id, in this order.`,
    ...slots.map(
      (slot) =>
        `- ${slot.id} · ${slot.date} ${slot.time} · ${cmoSlotNetworks(slot).join("+")} ${slot.format} · pillar ${slot.pillar} · ${slot.approach} · ${slot.stage}${slot.seed ? ` · Build on ${slot.seed}` : ""}${repair?.repeated.get(slot.id) ? ` · Repeated ${repair.repeated.get(slot.id)}: make another point with another title` : ""}`,
    ),
    avoid.length > 0
      ? [
          "Titles already in the month, which these must not repeat in other words:",
          ...avoid.map((title) => `- ${title}`),
        ].join("\n")
      : "",
    repair?.spent.length
      ? [
          "Points the month already makes as often as it may, which these must not argue again:",
          ...repair.spent.map((claim) => `- ${claim}`),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A written post as a calendar entry; null when the model left it unusable. */
export function cmoSlotEntry(
  slot: CmoMonthSlot,
  written: Written | undefined,
): CmoCalendarEntry | null {
  const title = clean(written?.title ?? "", 120);
  const brief = clean(written?.brief ?? "", 1_200);
  if (!title || !brief) return null;
  const why = clean(written?.why ?? "", 300);
  const claim = clean(written?.claim ?? "", 300);
  const story =
    slot.approach === "social-proof" ? clean(written?.story ?? "", 300) : "";
  const entry = cmoCalendarEntrySchema.safeParse({
    id: slot.id,
    date: slot.date,
    time: slot.time,
    channel: slot.channel,
    format: slot.format,
    status: "idea",
    title,
    brief,
    ...(why ? { why } : {}),
    ...(claim ? { claim } : {}),
    ...(story ? { story } : {}),
    pillar: slot.pillar,
    approach: slot.approach,
    stage: slot.stage,
    ...(slot.alsoOn?.length ? { alsoOn: slot.alsoOn } : {}),
  });
  return entry.success ? entry.data : null;
}

/** Runs `tasks` with at most `limit` at once, each settled on its own. */
async function inTurns<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]!().then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
  return results;
}

/**
 * The entries of `calendar` (oldest first) that say what an earlier entry
 * says: a title repeated by meaning, or a claim past its limit. The earlier
 * one stays; the examples come first, so they always stay.
 */
export async function cmoMonthRepeats(
  calendar: readonly CmoCalendarEntry[],
  find: typeof findRepeats = findRepeats,
): Promise<{
  ids: Set<string>;
  /** What each repeating post repeats: the earlier title or the point. */
  repeated: Map<string, string>;
  /** Points argued by as many posts as one point may have. */
  spent: { pillar: string | undefined; claim: string }[];
  costUsd: number;
}> {
  const live = calendar.filter((entry) => entry.status !== "skipped");
  const ids = new Set<string>();
  const repeated = new Map<string, string>();
  const titles = await find(
    live.map((entry) => entry.title),
    "title",
  );
  titles.repeats.forEach((earlier, index) => {
    if (earlier === null) return;
    ids.add(live[index]!.id);
    repeated.set(live[index]!.id, `the title "${live[earlier]?.title}"`);
  });
  const arguing = live.filter((entry) => entry.claim?.trim());
  const claims = await find(
    arguing.map((entry) => entry.claim ?? ""),
    "claim",
  );
  const group = arguing.map((_, index) => index);
  claims.repeats.forEach((earlier, index) => {
    if (earlier !== null) group[index] = group[earlier] ?? earlier;
  });
  const count = new Map<number, number>();
  group.forEach((first, index) => {
    const seen = (count.get(first) ?? 0) + 1;
    count.set(first, seen);
    if (seen <= MAX_CLAIM_POSTS) return;
    ids.add(arguing[index]!.id);
    repeated.set(arguing[index]!.id, `the point "${arguing[first]?.claim}"`);
  });
  const spent = [...count]
    .filter(([, seen]) => seen >= MAX_CLAIM_POSTS)
    .map(([first]) => ({
      pillar: arguing[first]?.pillar,
      claim: arguing[first]?.claim ?? "",
    }));
  return {
    ids,
    repeated,
    spent,
    costUsd: titles.costUsd + claims.costUsd,
  };
}

/** What the written month breaks of its strategy: the shares and every step. */
export function cmoMonthCalendarProblems(
  plan: Pick<MarketingStrategyPlan, "mix" | "pillars">,
  calendar: readonly CmoCalendarEntry[],
): string[] {
  const live = calendar.filter((entry) => entry.status !== "skipped");
  const stages = ["awareness", "interest", "desire", "action"] as const;
  const empty = stages.filter(
    (stage) => !live.some((entry) => entry.stage === stage),
  );
  return [
    ...mixProblems(plan.mix, live),
    ...pillarProblems(plan.pillars, live),
    ...(live.length >= stages.length && empty.length > 0
      ? [`no post serves ${empty.join(" or ")}`]
      : []),
  ];
}

/**
 * The posts a month's calendar holds against `cmoMonthFloor`: a short or a
 * talking video on every network it goes out on, since a talking video
 * takes a short video's slot, or a Facebook post's.
 */
export function cmoMonthPostsPlanned(
  calendar: readonly CmoCalendarEntry[],
): number {
  return calendar
    .filter((entry) => entry.status !== "skipped" && !entry.videoOf)
    .reduce((sum, entry) => sum + cmoSlotNetworks(entry).length, 0);
}

interface WriteContext {
  cuso: Cuso;
  versionId: string;
  plan: MarketingStrategyPlan;
  level: CmoVolumeLevel;
  start: string;
  key: string;
}

/** Writes slots in chunks at once; returns the entries written and the cost. */
async function writeSlots(
  context: WriteContext,
  system: string,
  slots: readonly CmoMonthSlot[],
  avoid: (chunk: readonly CmoMonthSlot[]) => string[],
  round: string,
  repair?: (chunk: readonly CmoMonthSlot[]) => {
    repeated: ReadonlyMap<string, string>;
    spent: readonly string[];
  },
): Promise<{ entries: CmoCalendarEntry[]; costUsd: number }> {
  const chunks = cmoMonthChunks(slots, context.start, SLOTS_PER_CHUNK);
  let costUsd = 0;
  const request = sokoBotModelRequest({
    role: "agent",
    model: CMO_MONTH_CALENDAR_MODEL,
    purpose: "cmo",
  });
  const writeChunk = async (chunk: CmoMonthSlot[], index: number) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const call = await generateText({
          ...request,
          telemetry: { functionId: "cmo-month-calendar" },
          providerOptions: {
            ...request.providerOptions,
            openai: { reasoningEffort: "low" },
          },
          system,
          prompt: cmoMonthChunkPrompt(chunk, avoid(chunk), repair?.(chunk)),
          output: Output.object({ schema: writtenSchema }),
          maxOutputTokens: 16_000,
          abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
        }).catch(rethrowAiGatewayFailure);
        const usage = gatewayCallUsage(call as never);
        const cost =
          gatewayCostUsd(call.providerMetadata) ||
          usage.inputTokens * PRICE.input + usage.outputTokens * PRICE.output;
        costUsd += cost;
        await recordSokoBotCheckUsage({
          sokoBotId: context.cuso.sokoBotId,
          key: `${context.key}:${round}:${index}:${attempt}`,
          costUsd: cost,
        }).catch(() => undefined);
        const byId = new Map(
          writtenSchema
            .parse(call.output)
            .posts.map((post) => [post.id.trim(), post]),
        );
        return chunk.flatMap((slot) => {
          const entry = cmoSlotEntry(slot, byId.get(slot.id));
          return entry ? [entry] : [];
        });
      } catch (error) {
        if (attempt >= CHUNK_TRIES) throw error;
      }
    }
  };
  const settled = await inTurns(
    chunks.map((chunk, index) => () => writeChunk(chunk, index)),
    CONCURRENT_CHUNKS,
  );
  const entries = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  const failed = settled.find((result) => result.status === "rejected");
  if (failed && entries.length === 0)
    throw (failed as PromiseRejectedResult).reason;
  return { entries, costUsd };
}

/** Titles of a pillar already in the month, for a chunk to steer clear of. */
function pillarTitles(
  calendar: readonly CmoCalendarEntry[],
  chunk: readonly CmoMonthSlot[],
): string[] {
  const pillars = new Set(chunk.map((slot) => slot.pillar));
  return calendar
    .filter((entry) => entry.pillar && pillars.has(entry.pillar))
    .map((entry) => entry.title)
    .slice(-160);
}

/**
 * Writes the month's missing posts: one pass in parallel, then up to two
 * rounds that rewrite each post repeating another. What could not be
 * written stays missing for the next write.
 */
export async function writeCmoMonthCalendar(context: WriteContext): Promise<{
  entries: CmoCalendarEntry[];
  missing: number;
  repeats: number;
  costUsd: number;
}> {
  const { cuso, plan } = context;
  const brain = parseBrandBrain((await getBrandBrain(cuso.projectId))?.body);
  const [industry, production] = await Promise.all([
    readCmoIndustry(cuso.projectId).catch(() => null),
    import("@/services/cmo-production.service"),
  ]);
  const praise = await production.cmoPraiseOnly(
    production.cmoProofPoints(brain),
  );
  const slots = cmoPlanMonthSlots({
    plan,
    level: context.level,
    start: context.start,
    seeds: cmoPillarSeeds(plan, industry),
    proof: praise.points,
  });
  if (slots.length === 0)
    return { entries: [], missing: 0, repeats: 0, costUsd: 0 };
  const system = cmoMonthCalendarSystem({
    businessName: cuso.businessName,
    websiteUrl: cuso.websiteUrl,
    plan,
    brain,
    proof: praise.points,
    industry: industry?.items.map(cmoIndustryLine) ?? [],
  });
  const examples = plan.calendar.filter((entry) => entry.status !== "skipped");
  const first = await writeSlots(
    context,
    system,
    slots,
    () => examples.map((entry) => entry.title),
    "write",
  );
  let costUsd = praise.costUsd + first.costUsd;
  const written = new Map(first.entries.map((entry) => [entry.id, entry]));
  const order = (entries: Iterable<CmoCalendarEntry>) =>
    [...entries].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time ?? "").localeCompare(b.time ?? ""),
    );
  let repeats = 0;
  for (let round = 1; round <= REPAIR_ROUNDS; round++) {
    const month = [...examples, ...order(written.values())];
    const found = await cmoMonthRepeats(month);
    costUsd += found.costUsd;
    const again = slots.filter((slot) => found.ids.has(slot.id));
    repeats = again.length;
    if (again.length === 0) break;
    const kept = month.filter((entry) => !found.ids.has(entry.id));
    const rewrite = await writeSlots(
      context,
      system,
      again,
      (chunk) => pillarTitles(kept, chunk),
      `repair${round}`,
      (chunk) => {
        const pillars = new Set(chunk.map((slot) => slot.pillar));
        return {
          repeated: found.repeated,
          spent: found.spent
            .filter((point) => !point.pillar || pillars.has(point.pillar))
            .map((point) => point.claim),
        };
      },
    ).catch(() => ({ entries: [], costUsd: 0 }));
    costUsd += rewrite.costUsd;
    for (const entry of rewrite.entries) written.set(entry.id, entry);
  }
  return {
    entries: order(written.values()),
    missing: slots.length - written.size,
    repeats,
    costUsd,
  };
}

type WriterState = CmoMonthWriter;

/** Whether the month is written for this plan level. */
export function cmoMonthCalendarWritten(
  writer: WriterState | undefined,
  level: CmoVolumeLevel,
): boolean {
  return writer?.state === "written" && writer.level === level;
}

/**
 * Whether a write may start now: none is running (or it went stale), and
 * after its tries ran out Core waits a few hours between tries.
 */
export function cmoMonthCalendarDue(
  writer: WriterState,
  level: CmoVolumeLevel,
  now: Date,
): boolean {
  if (cmoMonthCalendarWritten(writer, level)) return false;
  const started = writer.startedAt ? Date.parse(writer.startedAt) : null;
  const ended = writer.endedAt ? Date.parse(writer.endedAt) : null;
  const running = started !== null && (ended === null || ended < started);
  if (running) return now.getTime() - started >= CMO_MONTH_CALENDAR_STALE_MS;
  const attempts = writer.level === level ? writer.attempts : 0;
  if (attempts < CMO_MONTH_CALENDAR_ATTEMPTS || ended === null) return true;
  return now.getTime() - ended >= CMO_MONTH_CALENDAR_RETRY_MS;
}

/** Reads the approved version under a row lock, for one write at a time. */
async function lockedPlan(
  tx: Prisma.TransactionClient,
  versionId: string,
): Promise<{ plan: MarketingStrategyPlan; approvedAt: Date } | null> {
  await tx.$executeRaw`SELECT 1 FROM marketing_strategy WHERE id = ${versionId}::uuid FOR UPDATE`;
  const version = await tx.marketingStrategy.findUnique({
    where: { id: versionId },
    select: { plan: true, approvedAt: true },
  });
  const plan = parseMarketingPlan(version?.plan);
  return plan && version?.approvedAt
    ? { plan, approvedAt: version.approvedAt }
    : null;
}

/** Takes the next write for this version, or null when one runs or is not due. */
/**
 * Whether the Project pays for a month at this level now, read once: an
 * active plan of that tier, or Tester credits (the top level). Production
 * reads "subscribed" and the level apart, so a plan ending between them
 * would otherwise read as the top level and write a Scale month for nobody.
 * An eval lane's Cuso stands in for a customer at any level.
 */
async function paysForLevel(
  projectId: string,
  level: CmoVolumeLevel,
  now: Date,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  if (await isEvalCusoProject(projectId)) return true;
  const paid = await cmoPaidFor(projectId, now, tx);
  if (!paid.subscribed && !paid.testerCreditsLeft) return false;
  return (
    cmoVolumeLevelForTier(paid.testerCreditsLeft ? null : paid.tier) === level
  );
}

async function claimWrite(
  cuso: Cuso,
  versionId: string,
  level: CmoVolumeLevel,
  now: Date,
): Promise<{ plan: MarketingStrategyPlan; writer: WriterState } | null> {
  return prisma.$transaction(async (tx) => {
    const locked = await lockedPlan(tx, versionId);
    const writer = locked?.plan.monthWriter;
    if (!locked || !writer || !cmoMonthCalendarDue(writer, level, now))
      return null;
    if (!(await paysForLevel(cuso.projectId, level, now, tx))) return null;
    const next: WriterState = {
      ...writer,
      state: "writing",
      level,
      start: writer.start ?? cmoMonthStart(locked.plan, now),
      attempts: (writer.level === level ? writer.attempts : 0) + 1,
      startedAt: now.toISOString(),
    };
    const plan = { ...locked.plan, monthWriter: next };
    await tx.marketingStrategy.update({
      where: { id: versionId },
      data: { plan: jsonInput(plan) },
    });
    return { plan, writer: next };
  });
}

/**
 * Saves what a write made: its entries join the approved version's calendar
 * and become its Social posts, and the writer says whether the month is
 * whole. Entries another write saved first are kept as they are.
 */
async function saveWrite(input: {
  cuso: Cuso;
  versionId: string;
  startedAt: string;
  entries: CmoCalendarEntry[];
  whole: boolean;
  error?: string;
  costUsd: number;
  now: Date;
}): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const locked = await lockedPlan(tx, input.versionId);
      const writer = locked?.plan.monthWriter;
      if (!locked || !writer) return;
      const held = new Set(locked.plan.calendar.map((entry) => entry.id));
      const fresh = input.entries.filter((entry) => !held.has(entry.id));
      // A write that went stale and was taken over keeps its posts, and
      // leaves the state to the write that took over.
      const own = writer.startedAt === input.startedAt;
      const plan: MarketingStrategyPlan = {
        ...locked.plan,
        calendar: [...locked.plan.calendar, ...fresh],
        monthWriter: own
          ? {
              ...writer,
              state: input.whole ? "written" : "writing",
              endedAt: input.now.toISOString(),
              error: input.whole ? undefined : input.error?.slice(0, 300),
              costUsd:
                Math.round(((writer.costUsd ?? 0) + input.costUsd) * 1000) /
                1000,
            }
          : writer,
      };
      await tx.marketingStrategy.update({
        where: { id: input.versionId },
        data: { plan: jsonInput(plan) },
      });
      const today = input.now.toISOString().slice(0, 10);
      await planMarketingStrategyPosts(tx, {
        version: { id: input.versionId, projectId: input.cuso.projectId },
        workspaceId: input.cuso.workspaceId,
        entries: fresh.filter((entry) => entry.date >= today),
        creator: { sokoBotId: input.cuso.sokoBotId },
      });
    },
    { timeout: 60_000 },
  );
}

/**
 * Writes the month of an approved, paid cmo-v22 version when it is due:
 * claims the write, plans and writes every missing post, saves them, and
 * moves production on. Returns whether the month is whole for the level.
 */
export async function runCmoMonthCalendar(
  cuso: Cuso,
  versionId: string,
  level: CmoVolumeLevel,
  now: Date = new Date(),
  /** An eval writes the month alone: no production run follows. */
  options: { kickProduction?: boolean } = {},
): Promise<boolean> {
  const claimed = await claimWrite(cuso, versionId, level, now);
  if (!claimed) return false;
  // One clock for the claim and the end, so a caller's `now` holds for both.
  const began = Date.now();
  const clock = () => new Date(now.getTime() + (Date.now() - began));
  const { plan, writer } = claimed;
  const startedAt = writer.startedAt ?? now.toISOString();
  const start = writer.start ?? cmoMonthStart(plan, now);
  try {
    const result = await writeCmoMonthCalendar({
      cuso,
      versionId,
      plan,
      level,
      start,
      key: `cmo-month-calendar:${versionId}:${level}:${writer.attempts}`,
    });
    const whole = result.missing === 0;
    const calendar = [...plan.calendar, ...result.entries];
    const problems = cmoMonthCalendarProblems(plan, calendar);
    const floor = cmoMonthFloor(plan.channels, level).total;
    const planned = cmoMonthPostsPlanned(
      calendar.filter((entry) => {
        const day = (Date.parse(entry.date) - Date.parse(start)) / DAY_MS;
        return day >= 0 && day < CMO_MONTH_DAYS;
      }),
    );
    await saveWrite({
      cuso,
      versionId,
      startedAt,
      entries: result.entries,
      whole,
      ...(whole ? {} : { error: `${result.missing} posts not written` }),
      costUsd: result.costUsd,
      now: clock(),
    });
    const log = createCoreLogger({
      operation: "cmo_month_calendar",
      sokoBot: { id: cuso.sokoBotId },
    });
    log.set({
      cmoMonthCalendar: {
        versionId,
        level,
        attempt: writer.attempts,
        written: result.entries.length,
        missing: result.missing,
        repeats: result.repeats,
        planned,
        floor,
        problems,
        costUsd: Math.round(result.costUsd * 1000) / 1000,
        seconds: Math.round((Date.now() - began) / 1000),
      },
    });
    log.emit();
    if (whole && planned < floor)
      emitCoreError(
        { operation: "cmo_month_calendar", sokoBot: { id: cuso.sokoBotId } },
        {
          message:
            "A CMO month's calendar holds fewer posts than its plan promises",
          why: `${planned} posts planned against the plan's floor of ${floor}`,
          fix: "Read cmo-month-slots.ts against this strategy's channels: the planner should place every post the plan's rates call for.",
        },
        { alert: "cmo_month_below_floor", planned, floor, level },
      );
    if (!whole && writer.attempts >= CMO_MONTH_CALENDAR_ATTEMPTS)
      emitCoreError(
        { operation: "cmo_month_calendar", sokoBot: { id: cuso.sokoBotId } },
        {
          message: "Core could not write a whole CMO month",
          why: `${writer.attempts} writes ended with ${result.missing} posts missing; Core tries again in three hours`,
          fix: "Look up this event's earlier cmo_month_calendar warnings for the chunk errors; the owner sees that Cuso is planning the month.",
        },
        { alert: "cmo_month_calendar_stuck", missing: result.missing },
      );
    if (whole && options.kickProduction !== false) {
      const { kickCmoProduction } = await import(
        "@/services/cmo-production.service"
      );
      kickCmoProduction(cuso.sokoBotId);
    }
    return whole;
  } catch (error) {
    await saveWrite({
      cuso,
      versionId,
      startedAt,
      entries: [],
      whole: false,
      error: error instanceof Error ? error.name : "failed",
      costUsd: 0,
      now: clock(),
    }).catch(() => undefined);
    const context = {
      operation: "cmo_month_calendar",
      sokoBot: { id: cuso.sokoBotId },
      failure: messageSafeErrorFields(error),
    };
    const said = {
      message: "Core's write of a CMO month failed",
      why: `Attempt ${writer.attempts} threw`,
      fix: "The next CMO production sync tries again, every 10 minutes until three tries, then every three hours. Look up the error name and code under failure.",
    };
    if (writer.attempts >= CMO_MONTH_CALENDAR_ATTEMPTS)
      emitCoreError(context, said, { alert: "cmo_month_calendar_stuck" });
    else emitCoreWarning(context, said);
    return false;
  }
}

/** Starts the month's write in the background; the caller does not wait. */
export function kickCmoMonthCalendar(
  cuso: Cuso,
  versionId: string,
  level: CmoVolumeLevel,
): void {
  waitUntil(
    runAsBackgroundWork(() =>
      runCmoMonthCalendar(cuso, versionId, level).catch((error: unknown) => {
        emitCoreWarning(
          {
            operation: "cmo_month_calendar",
            sokoBot: { id: cuso.sokoBotId },
            failure: messageSafeErrorFields(error),
          },
          {
            message: "Core's write of a CMO month did not start",
            why: "Claiming or running the write threw",
            fix: "The next CMO production sync tries again.",
          },
        );
      }),
    ),
  );
}
