import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import {
  answerBrandBrainQuestion,
  parseBrandBrain,
} from "@/services/brand-brain.service";
import { type Cuso, findCusoForBot } from "@/services/cmo-cuso.service";
import { startCmoOnboarding } from "@/services/cmo-hiring.service";
import { advanceCmoProduction } from "@/services/cmo-production.service";
import { applyCmoPlanAnswers } from "@/services/cmo-strategy.service";
import {
  answerMarketingStrategyQuestion,
  approveMarketingStrategy,
  newestMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";
import { brandBrainChecks, strategyChecks } from "../cmo-brand-checks";
import { askInRoom } from "../ownerbench/journey-runner";
import {
  attachCuso,
  type CmoPathLane,
  connectBrandAccounts,
  createCmoPathLane,
} from "./lane";
import { SimulatedOwner } from "./owner";
import type { CmoPathBrand } from "./types";

export interface Check {
  label: string;
  pass: boolean;
  actual: string;
}

export type CmoPathStageId =
  | "brand-brain"
  | "strategy"
  | "month"
  | "mid-month"
  | "report";

export interface CmoPathStageResult {
  stage: CmoPathStageId;
  /** Every DONE RIGHT check passed. */
  pass: boolean;
  checks: Check[];
  startedAt: string;
  endedAt: string;
}

export interface CmoPathBrandResult {
  brand: string;
  mode: "real" | "noop";
  lane: number;
  stages: CmoPathStageResult[];
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
const ACTIVE = ["QUEUED", "STARTING", "RUNNING", "CANCEL_REQUESTED"] as const;
/** Social posts the month made that have not gone out. */
const UNSENT = ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"] as const;

function check(label: string, pass: boolean, actual: unknown): Check {
  return { label, pass, actual: String(actual).slice(0, 300) };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Until Cuso has no turn in flight and none started for `quietMs`, or
 * `timeoutMs` passes. Core chains turns on its own (research, then the
 * plan, then finish turns), so one quiet poll is not enough.
 */
async function untilIdle(
  botId: string,
  timeoutMs: number,
  quietMs = 60 * SECOND,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let quietSince: number | null = null;
  while (Date.now() < deadline) {
    const active = await prisma.sokoBotTurn.count({
      where: { sokoBotId: botId, status: { in: [...ACTIVE] } },
    });
    if (active > 0) quietSince = null;
    else {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMs) return;
    }
    await wait(5 * SECOND);
  }
}

async function runStage<T>(
  id: CmoPathStageId,
  work: () => Promise<{ checks: Check[]; value: T }>,
): Promise<{ result: CmoPathStageResult; value: T | null }> {
  const startedAt = new Date().toISOString();
  try {
    const { checks, value } = await work();
    return {
      result: {
        stage: id,
        pass: checks.length > 0 && checks.every((c) => c.pass),
        checks,
        startedAt,
        endedAt: new Date().toISOString(),
      },
      value,
    };
  } catch (error) {
    return {
      result: {
        stage: id,
        pass: false,
        checks: [check("Stage ran", false, (error as Error).message)],
        startedAt,
        endedAt: new Date().toISOString(),
      },
      value: null,
    };
  }
}

/** A Cuso nobody briefs: the do-nothing run's, so every stage must fail. */
async function idleCuso(lane: CmoPathLane, brand: CmoPathBrand): Promise<Cuso> {
  const project = await prisma.project.create({
    data: {
      workspaceId: lane.workspaceId,
      name: `${brand.eval.name} marketing`,
      websiteUrl: brand.eval.url,
    },
    select: { id: true },
  });
  const { createSharedSokoBot } = await import(
    "@/services/soko-bot-shared-create.service"
  );
  const bot = await createSharedSokoBot({
    callerUserId: lane.userId,
    workspaceId: lane.workspaceId,
    projectId: project.id,
    name: "Cuso",
    versionId: CMO_SOKO_BOT_VERSION_ID,
    timezone: brand.owner.timeZone,
  });
  const cuso = await findCusoForBot(bot.id);
  if (!cuso) throw new Error("No Cuso for the do-nothing run");
  return cuso;
}

/** Stage 1: the brand's own site, read into its Brand Brain and look. */
async function brandBrainStage(
  brand: CmoPathBrand,
  cuso: Cuso,
  owner: SimulatedOwner,
  real: boolean,
) {
  if (real) {
    await untilIdle(cuso.sokoBotId, 25 * MINUTE);
    const saved = await prisma.brandBrain.findUnique({
      where: { projectId: cuso.projectId },
      select: { body: true },
    });
    for (const question of parseBrandBrain(saved?.body)?.questions ?? []) {
      if (question.answer) continue;
      const { answer, note } = await owner.answer(question.statement);
      await answerBrandBrainQuestion(cuso.projectId, {
        questionId: question.id,
        answer,
        ...(note ? { note } : {}),
      });
    }
  }
  const [brain, project, siteReads] = await Promise.all([
    prisma.brandBrain.findUnique({
      where: { projectId: cuso.projectId },
      select: { body: true },
    }),
    prisma.project.findUniqueOrThrow({
      where: { id: cuso.projectId },
      select: { logo: true, studioBrandLook: true },
    }),
    prisma.sokoBotToolCall.count({
      where: {
        turn: { sokoBotId: cuso.sokoBotId },
        capability: "web_fetch",
        status: "COMPLETED",
        input: { path: ["url"], string_contains: brand.domain },
      },
    }),
  ]);
  const { checks } = brandBrainChecks(brand.eval, brain?.body);
  const text = JSON.stringify(brain?.body ?? {});
  for (const fact of brand.facts) {
    const found = new RegExp(fact.pattern, "i").exec(text);
    checks.push(
      check(`Has ${fact.label}`, Boolean(found), found?.[0] ?? "missing"),
    );
  }
  const look = JSON.stringify(project.studioBrandLook ?? {}).toLowerCase();
  checks.push(
    check("Read the brand's site", siteReads > 0, `${siteReads} pages fetched`),
    check(
      "Saved the brand's logo",
      Boolean(project.logo),
      project.logo ?? "none",
    ),
    check(
      "The look carries the brand's colours",
      brand.colors.some((color) => look.includes(color.toLowerCase())),
      look.slice(0, 200) || "no look",
    ),
  );
  return { checks, value: null };
}

/** Stage 2: the strategy Core starts after research, answered and approved. */
async function strategyStage(
  brand: CmoPathBrand,
  lane: CmoPathLane,
  cuso: Cuso,
  owner: SimulatedOwner,
  real: boolean,
) {
  const target = {
    userId: lane.userId,
    workspaceId: lane.workspaceId,
    projectId: cuso.projectId,
  };
  if (real) {
    await untilIdle(cuso.sokoBotId, 30 * MINUTE);
    const draft = await newestMarketingStrategy(cuso.projectId);
    const questions = parseMarketingPlan(draft?.plan)?.questions ?? [];
    let answered = 0;
    for (const question of questions) {
      if (!draft || question.answer) continue;
      const { answer, note } = await owner.answer(question.statement);
      await answerMarketingStrategyQuestion({
        projectId: cuso.projectId,
        strategyId: draft.id,
        questionId: question.id,
        answer,
        ...(note ? { note } : {}),
      });
      answered++;
    }
    if (answered > 0) {
      await applyCmoPlanAnswers(target).catch(() => undefined);
      await untilIdle(cuso.sokoBotId, 30 * MINUTE);
    }
    const ready = await newestMarketingStrategy(cuso.projectId);
    if (ready && !ready.approvedAt)
      await approveMarketingStrategy({ ...target, strategyId: ready.id });
  }
  const approved = await prisma.marketingStrategy.findMany({
    where: { projectId: cuso.projectId, approvedAt: { not: null } },
    orderBy: { approvedAt: "desc" },
    select: { id: true, plan: true },
  });
  const { strategy, checks } = strategyChecks(brand.eval, approved[0]?.plan);
  const planned = new Set(
    (strategy?.calendar ?? []).map((entry) => entry.channel.toLowerCase()),
  );
  const connected = new Set<string>(
    brand.networks.map((network) =>
      network === "linkedin-page" ? "linkedin" : network,
    ),
  );
  const offNetworks = [...planned].filter(
    (channel) => SOCIAL_CHANNELS.has(channel) && !connected.has(channel),
  );
  checks.unshift(
    check(
      "Exactly one approved strategy",
      approved.length === 1,
      approved.length,
    ),
  );
  checks.push(
    check(
      "Plans every connected network",
      [...connected].every((network) => planned.has(network)),
      [...planned].join(", ") || "no calendar",
    ),
    check(
      "Plans no social network the owner has not connected",
      offNetworks.length === 0,
      offNetworks.join(", ") || "none",
    ),
  );
  return { checks, value: approved[0]?.id ?? null };
}

const SOCIAL_CHANNELS = new Set([
  "x",
  "linkedin",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
]);

/** Stage 3: the month after payment, made until production goes quiet. */
async function monthStage(
  cuso: Cuso,
  strategyId: string | null,
  real: boolean,
) {
  if (real && strategyId) {
    const deadline = Date.now() + 90 * MINUTE;
    let unchanged = 0;
    let last = -1;
    while (Date.now() < deadline && unchanged < 6) {
      await advanceCmoProduction(cuso).catch(() => undefined);
      await untilIdle(cuso.sokoBotId, 20 * MINUTE, 20 * SECOND);
      const made = await prisma.socialPost.count({
        where: { marketingStrategyId: strategyId, text: { not: "" } },
      });
      unchanged = made === last ? unchanged + 1 : 0;
      last = made;
    }
  }
  const strategy = strategyId
    ? await prisma.marketingStrategy.findUnique({
        where: { id: strategyId },
        select: { plan: true },
      })
    : null;
  const calendar = parseMarketingPlan(strategy?.plan)?.calendar ?? [];
  const socialEntries = calendar.filter((entry) =>
    SOCIAL_CHANNELS.has(entry.channel.toLowerCase()),
  );
  const posts = strategyId
    ? await prisma.socialPost.findMany({
        where: { marketingStrategyId: strategyId },
        select: { provider: true, text: true, media: true, status: true },
      })
    : [];
  const written = posts.filter((post) => post.text.trim().length > 0);
  const byNetwork = (
    items: readonly { provider?: string; channel?: string }[],
  ) => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = (item.provider ?? item.channel ?? "").toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const planned = byNetwork(socialEntries);
  const made = byNetwork(written);
  const short = [...planned].filter(
    ([network, count]) => (made.get(network) ?? 0) < count,
  );
  const visual = written.filter(
    (post) => Array.isArray(post.media) && post.media.length > 0,
  );
  const checks = [
    check(
      "The approved month has social pieces",
      socialEntries.length > 0,
      socialEntries.length,
    ),
    check(
      "Every planned social piece is a written post",
      socialEntries.length > 0 && short.length === 0,
      short
        .map(
          ([network, count]) =>
            `${network}: ${made.get(network) ?? 0}/${count}`,
        )
        .join(", ") || `${written.length}/${socialEntries.length}`,
    ),
    check(
      "Posts carry their pictures or videos",
      written.length > 0 && visual.length >= Math.ceil(written.length / 2),
      `${visual.length}/${written.length} with media`,
    ),
    check(
      "Nothing was published",
      posts.every((post) => post.status !== "PUBLISHED"),
      posts.filter((post) => post.status === "PUBLISHED").length,
    ),
  ];
  return { checks, value: null };
}

interface PostSnapshot {
  id: string;
  provider: string;
  text: string;
  status: string;
  scheduledAt: string | null;
  media: string;
}

async function snapshot(projectId: string): Promise<Map<string, PostSnapshot>> {
  const posts = await prisma.socialPost.findMany({
    where: { projectId },
    select: {
      id: true,
      provider: true,
      text: true,
      status: true,
      scheduledAt: true,
      media: true,
    },
  });
  return new Map(
    posts.map((post) => [
      post.id,
      {
        ...post,
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
        media: JSON.stringify(post.media ?? null),
      },
    ]),
  );
}

/**
 * Mid-month: the first half of the month's posts went out (stand-in ids),
 * with the brand's planted pattern in their statistics for stage 5.
 */
async function sendFirstHalf(
  brand: CmoPathBrand,
  projectId: string,
): Promise<void> {
  const posts = await prisma.socialPost.findMany({
    where: { projectId, status: { in: [...UNSENT] }, text: { not: "" } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, provider: true, media: true },
  });
  const sent = posts.slice(0, Math.ceil(posts.length / 2));
  for (const [index, post] of sent.entries()) {
    const kinds = Array.isArray(post.media)
      ? post.media.map((item) => (item as { kind?: string }).kind ?? "image")
      : [];
    const wins =
      post.provider === brand.analytics.winner.network &&
      (kinds.length === 0
        ? brand.analytics.winner.kinds.includes("text")
        : kinds.some((kind) =>
            (brand.analytics.winner.kinds as readonly string[]).includes(kind),
          ));
    const base = 180 + ((index * 37) % 60);
    const factor = wins ? brand.analytics.factor : 1;
    await prisma.socialPost.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(Date.now() - (sent.length - index) * DAY),
        publishedExternalId: `eval-${post.provider}-${post.id.slice(-12)}`,
        statistics: {
          metrics: {
            views: base * factor,
            impressions: Math.round(base * 1.3 * factor),
            likes: Math.round(base * 0.04 * factor),
            comments: Math.round(base * 0.006 * factor),
            shares: Math.round(base * 0.008 * factor),
            saves: Math.round(base * 0.005 * factor),
          },
          fetchedAt: new Date().toISOString(),
          refreshAttemptedAt: new Date().toISOString(),
          error: null,
        },
      },
    });
  }
}

/** Stage 4: one owner change in chat, which must reach exactly its posts. */
async function midMonthStage(
  brand: CmoPathBrand,
  lane: CmoPathLane,
  cuso: Cuso,
  real: boolean,
) {
  const before = await snapshot(cuso.projectId);
  const unsent = [...before.values()].filter((post) =>
    (UNSENT as readonly string[]).includes(post.status),
  );
  const { network, phrase } = brand.change.selector;
  const expected = new Set(
    unsent
      .filter(
        (post) =>
          (!network || post.provider === network) &&
          (!phrase || post.text.toLowerCase().includes(phrase.toLowerCase())),
      )
      .map((post) => post.id),
  );
  if (real) {
    const room = await sharedRoom(cuso.sokoBotId);
    const turn = await askInRoom(
      room,
      lane.userId,
      cuso.sokoBotId,
      brand.change.message,
    );
    if (typeof turn !== "string") throw new Error(turn.error);
    await untilIdle(cuso.sokoBotId, 20 * MINUTE);
  }
  const after = await snapshot(cuso.projectId);
  const wrong: string[] = [];
  const touched: string[] = [];
  for (const [id, old] of before) {
    const now = after.get(id);
    const same =
      now !== undefined &&
      now.text === old.text &&
      now.status === old.status &&
      now.scheduledAt === old.scheduledAt &&
      now.media === old.media;
    if (!expected.has(id)) {
      if (!same) touched.push(id);
      continue;
    }
    const reached =
      brand.change.kind === "drop-network"
        ? now?.status === "CANCELED"
        : brand.change.kind === "change-fact"
          ? Boolean(
              now?.text.includes(brand.change.replacement ?? "\u0000") &&
                !now.text.includes(phrase ?? "\u0000"),
            )
          : !same;
    if (!reached) wrong.push(id);
  }
  const sentChanged = [...before.values()].filter(
    (post) =>
      post.status === "PUBLISHED" && after.get(post.id)?.text !== post.text,
  );
  const checks = [
    check("The change has posts to reach", expected.size > 0, expected.size),
    check(
      "Every affected upcoming post was changed the right way",
      expected.size > 0 && wrong.length === 0,
      `${expected.size - wrong.length}/${expected.size}`,
    ),
    check(
      "No other post changed",
      touched.length === 0,
      `${touched.length} changed`,
    ),
    check(
      "No sent post changed",
      sentChanged.length === 0,
      `${sentChanged.length} changed`,
    ),
  ];
  return { checks, value: null };
}

async function sharedRoom(botId: string): Promise<string> {
  const bot = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: botId },
    select: { sharedRoomId: true },
  });
  if (!bot.sharedRoomId) throw new Error("Cuso has no room");
  return bot.sharedRoomId;
}

/** Stage 5: "What is working?" against the statistics stage 4 planted. */
async function reportStage(
  brand: CmoPathBrand,
  lane: CmoPathLane,
  cuso: Cuso,
  real: boolean,
) {
  const asked = new Date();
  if (real) {
    const room = await sharedRoom(cuso.sokoBotId);
    const turn = await askInRoom(
      room,
      lane.userId,
      cuso.sokoBotId,
      "What is working so far this month? What should we do more of?",
    );
    if (typeof turn !== "string") throw new Error(turn.error);
    await untilIdle(cuso.sokoBotId, 15 * MINUTE, 20 * SECOND);
  }
  const reply = await prisma.chatRoomMessage.findFirst({
    where: {
      roomId: await sharedRoom(cuso.sokoBotId),
      senderSokoBotId: cuso.sokoBotId,
      createdAt: { gt: asked },
    },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });
  const text = reply?.content ?? "";
  const published = await prisma.socialPost.findMany({
    where: { projectId: cuso.projectId, status: "PUBLISHED" },
    select: { provider: true, statistics: true },
  });
  const known = new Set<number>();
  const totals = new Map<string, number>();
  for (const post of published) {
    const metrics = ((
      post.statistics as { metrics?: Record<string, number> } | null
    )?.metrics ?? {}) as Record<string, number>;
    for (const value of Object.values(metrics)) known.add(value);
    totals.set(
      post.provider,
      (totals.get(post.provider) ?? 0) + (metrics.views ?? 0),
    );
  }
  for (const total of totals.values()) known.add(total);
  const quoted = (text.match(/\b\d[\d,.]{2,}\b/g) ?? [])
    .map((raw) => Number(raw.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value >= 100);
  const unknown = quoted.filter(
    (value) => ![...known].some((have) => Math.abs(have - value) <= 1),
  );
  const checks = [
    check("Cuso answered", text.length > 0, text.slice(0, 120) || "no reply"),
    check(
      "Names the planted winner",
      brand.analytics.winnerWords.some((word) =>
        text.toLowerCase().includes(word),
      ),
      brand.analytics.winner.network,
    ),
    check(
      "Quotes only numbers in the data",
      text.length > 0 && unknown.length === 0,
      unknown.join(", ") || "none unknown",
    ),
  ];
  return { checks, value: null };
}

/**
 * One brand through all five stages on a fresh lane. `noop` hires a Cuso
 * nobody briefs and sends no owner message: every stage must fail, which
 * is what shows the checks are not empty.
 */
export async function runCmoPathBrand(
  brand: CmoPathBrand,
  mode: "real" | "noop",
): Promise<CmoPathBrandResult> {
  const real = mode === "real";
  let lane = await createCmoPathLane(brand);
  const cuso = real
    ? await startCmoOnboarding({
        userId: lane.userId,
        websiteUrl: brand.eval.url,
        organizationId: lane.organizationId,
        timeZone: brand.owner.timeZone,
      })
    : await idleCuso(lane, brand);
  lane = await attachCuso(lane, cuso);
  await connectBrandAccounts(lane, brand, cuso.projectId);
  const owner = new SimulatedOwner(brand);
  const stages: CmoPathStageResult[] = [];

  stages.push(
    (
      await runStage("brand-brain", () =>
        brandBrainStage(brand, cuso, owner, real),
      )
    ).result,
  );
  const strategy = await runStage("strategy", () =>
    strategyStage(brand, lane, cuso, owner, real),
  );
  stages.push(strategy.result);
  stages.push(
    (await runStage("month", () => monthStage(cuso, strategy.value, real)))
      .result,
  );
  await sendFirstHalf(brand, cuso.projectId);
  stages.push(
    (await runStage("mid-month", () => midMonthStage(brand, lane, cuso, real)))
      .result,
  );
  stages.push(
    (await runStage("report", () => reportStage(brand, lane, cuso, real)))
      .result,
  );
  return { brand: brand.id, mode, lane: lane.lane, stages };
}
