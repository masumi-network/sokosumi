import { randomBytes } from "node:crypto";
import type { CmoWorkspace, Prisma } from "@sokosumi/database";
import {
  CMO_SOKO_BOT_VERSION_ID,
  type CmoBrandBrain,
  type CmoReportUpdateInput,
  type CmoStrategy,
  type CmoSystemSchedule,
  cmoBrandBrainSchema,
  cmoMayExecute,
  cmoReportUpdateInputSchema,
  cmoRoutineSkipReason,
  cmoStrategySchema,
  getSokoBotVersion,
  SOKO_BOT_CMO_SCHEDULES,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { isLocalDevHostname } from "@/config/cors-allow-origin";
import { getEnv, getWebAppBaseUrl } from "@/config/env";
import type { ProjectSocialProvider } from "@/config/social-providers";
import { buildCreditsPayload } from "@/helpers/subscription";
import {
  type BrandVisual,
  brandColors,
  brandFontName,
  readBrandVisual,
} from "@/lib/brand-visual";
import prisma from "@/lib/db/prisma";
import { uploadDesignMdContent } from "@/lib/design-md-blob";
import { resolveSiteIconAsProjectLogo } from "@/lib/site-icon";
import type { PresetRoute } from "@/lib/soko-bot/classifier";

/**
 * CMO.xyz (Cuso) on Soko Bots. Each business gets its own organization
 * workspace, so Cuso is an ordinary Soko Bot there (one bot per person and
 * workspace) and every existing seam — turns, schedules, chat, Social,
 * Content Studio, Tasks — works unchanged. This module adds what CMO needs on
 * top: onboarding, the Brand Brain and strategy records, the subscription
 * gate, and the packets Cuso's rhythms read.
 */

export class CmoNotFoundError extends Error {}
export class CmoConflictError extends Error {}

const CUSO_NAME = "Cuso";

/** Onboarding and strategy turns: owner asked, full work route. */
const CMO_ONBOARDING_ROUTE: PresetRoute = {
  route: "MANAGE_WORK",
  writeScope: "WORK",
  sandbox: true,
  reason: "CMO onboarding: learn the business and build the Brand Brain.",
};
/**
 * No sandbox on the strategy turn: a turn that has read the open web may not
 * create posts or images, and this one drafts the first week of content from
 * the Brand Brain it already has.
 */
const CMO_STRATEGY_ROUTE: PresetRoute = {
  route: "MANAGE_WORK",
  writeScope: "WORK",
  reason: "CMO strategy: plan the month and draft the first week.",
};

export const cmoBrandVisualSchema = z.object({
  logoUrl: z.string().url().nullable(),
  colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/)).max(8),
  fonts: z.array(z.string().max(80)).max(4),
  siteName: z.string().max(120).nullable(),
  designMdUrl: z.string().url().nullable(),
});
export type CmoBrandVisual = z.infer<typeof cmoBrandVisualSchema>;

export function parseCmoBrandVisual(value: unknown): CmoBrandVisual | null {
  const parsed = cmoBrandVisualSchema.safeParse(value);
  if (!parsed.success) return null;
  // Rows saved before the font filter tightened still carry fallbacks.
  const fonts = parsed.data.fonts
    .map(brandFontName)
    .filter((font): font is string => font !== null);
  return { ...parsed.data, fonts: [...new Set(fonts)] };
}

const DESIGN_MD_POLL_MS = 3_000;
const DESIGN_MD_BUDGET_MS = 120_000;

/**
 * The brand's DESIGN.md from the Masumi DESIGN.md API (the service Web uses),
 * stored on the CMO Project. Null when the API is not configured or fails.
 */
async function generateProjectDesignMd(
  projectId: string,
  websiteUrl: string,
): Promise<{ url: string; content: string } | null> {
  const env = getEnv();
  if (!env.MASUMI_DESIGN_MD_API_KEY) return null;
  const { createDesignMdClient } = await import("@sokosumi/masumi/tools");
  const client = createDesignMdClient({
    apiKey: env.MASUMI_DESIGN_MD_API_KEY,
    apiUrl: env.MASUMI_DESIGN_MD_API_URL,
  });
  const url = /^https?:\/\//i.test(websiteUrl)
    ? websiteUrl
    : `https://${websiteUrl}`;
  let result = await client.submit({ url });
  const deadline = Date.now() + DESIGN_MD_BUDGET_MS;
  while (
    result.isOk() &&
    (result.value.status === "queued" || result.value.status === "running") &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, DESIGN_MD_POLL_MS));
    result = await client.pollJob(result.value.jobId);
  }
  if (result.isErr() || result.value.status !== "done") return null;
  const done = result.value;
  const stored = await uploadDesignMdContent({
    content: done.designMd,
    owner: { kind: "project", id: projectId },
    extractionId: String(done.extractionId),
  });
  if (!stored) return null;
  await prisma.project.update({
    where: { id: projectId },
    data: {
      designMdUrl: stored,
      designMdExtractionId: String(done.extractionId),
    },
  });
  return { url: stored, content: done.designMd };
}

/**
 * Reads how the brand looks and keeps it on the CMO workspace: the logo (the
 * site's own, else its best icon stored as the Project logo), colours, fonts
 * and, when the API is configured, a DESIGN.md on the Project.
 */
export async function learnCmoBrandVisual(
  workspace: Pick<CmoWorkspace, "id" | "projectId" | "websiteUrl">,
): Promise<CmoBrandVisual> {
  const [site, icon, designMd] = await Promise.all([
    readBrandVisual(workspace.websiteUrl),
    resolveSiteIconAsProjectLogo(workspace.websiteUrl, workspace.projectId)
      .then(async (logo) => {
        if (logo) {
          await prisma.project.update({
            where: { id: workspace.projectId },
            data: { logo },
          });
        }
        return logo;
      })
      .catch(() => null),
    generateProjectDesignMd(workspace.projectId, workspace.websiteUrl).catch(
      () => null,
    ),
  ]);
  const visual = mergeBrandVisual(site, icon, designMd);
  await prisma.cmoWorkspace.update({
    where: { id: workspace.id },
    data: { brandVisual: visual as Prisma.InputJsonValue },
  });
  return visual;
}

/** The DESIGN.md's colours lead when there is one; the site fills the rest. */
export function mergeBrandVisual(
  site: BrandVisual,
  iconUrl: string | null,
  designMd: { url: string; content: string } | null,
): CmoBrandVisual {
  const designColors = designMd ? brandColors(designMd.content, 5) : [];
  return {
    logoUrl: site.logoUrl ?? iconUrl,
    colors: [...new Set([...designColors, ...site.colors])].slice(0, 5),
    fonts: site.fonts,
    siteName: site.siteName,
    designMdUrl: designMd?.url ?? null,
  };
}

/** The Project's name in Sokosumi: "CMO.xyz · Acme". */
export function cmoProjectName(businessName: string): string {
  return `CMO.xyz · ${businessName}`.slice(0, 120);
}

/**
 * Who pays for Cuso and whose plan opens execution: the workspace's
 * organization when it has one, otherwise the owner.
 */
async function cmoPayer(
  workspace: Pick<CmoWorkspace, "userId" | "workspaceId">,
): Promise<{ organizationId: string | null; referenceId: string }> {
  const row = await prisma.workspace.findUnique({
    where: { id: workspace.workspaceId },
    select: { organizationId: true },
  });
  const organizationId = row?.organizationId ?? null;
  return { organizationId, referenceId: organizationId ?? workspace.userId };
}

/** "https://www.acme.io/about" → "acme.io"; falls back to the raw input. */
export function cmoBusinessNameFromUrl(websiteUrl: string): string {
  try {
    return new URL(websiteUrl).hostname.replace(/^www\./, "");
  } catch {
    return websiteUrl.trim();
  }
}

export function parseCmoBrandBrain(value: unknown): CmoBrandBrain | null {
  const parsed = cmoBrandBrainSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseCmoStrategy(value: unknown): CmoStrategy | null {
  const parsed = cmoStrategySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function getCmoWorkspaceForUser(
  userId: string,
): Promise<CmoWorkspace | null> {
  return prisma.cmoWorkspace.findUnique({ where: { userId } });
}

export async function getCmoWorkspaceForBot(
  sokoBotId: string,
): Promise<CmoWorkspace | null> {
  return prisma.cmoWorkspace.findUnique({ where: { sokoBotId } });
}

/** The org's active plan that lets Cuso execute, or null. */
export async function activeCmoPlan(
  referenceId: string,
): Promise<string | null> {
  const plans = getEnv().CMO_SUBSCRIPTION_PLANS;
  const subscription = await prisma.subscription.findFirst({
    where: {
      referenceId,
      plan: { in: plans },
      status: { in: ["active", "trialing"] },
    },
    select: { plan: true },
  });
  return subscription?.plan ?? null;
}

/** Execution (scheduling, publishing) needs a paid plan on the org. */
export async function hasActiveCmoSubscription(
  referenceId: string,
): Promise<boolean> {
  return (await activeCmoPlan(referenceId)) !== null;
}

async function startCmoTurn(
  workspace: Pick<CmoWorkspace, "userId" | "workspaceId" | "sokoBotId">,
  input: { clientTurnId: string; message: string; route: PresetRoute },
): Promise<{ turnId: string }> {
  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  const started = await sokoBotControlPlane.startTurn({
    userId: workspace.userId,
    workspaceId: workspace.workspaceId,
    // Cuso, never the owner's personal assistant in the same workspace.
    sokoBotId: workspace.sokoBotId,
    clientTurnId: input.clientTurnId,
    message: input.message,
    // The owner pressed the button, but no chat message carries the turn:
    // EVENT delivers the answer to the owner's chat with Cuso.
    source: "EVENT",
    presetRoute: input.route,
  });
  return { turnId: started.turnId };
}

function onboardingMessage(input: {
  businessName: string;
  websiteUrl: string;
  goals: string;
}): string {
  return [
    `New CMO client: ${input.businessName} (${input.websiteUrl}).`,
    `Their main marketing goal, in their words: ${input.goals}`,
    "",
    "Learn the business. Read the website (home, about, products, pricing, blog), search for the company, its competitors and its existing marketing and social profiles, then save the Brand Brain with save_brand_brain. Write down only what you found.",
    "Do not plan yet: the owner reviews the Brand Brain first, then asks you for the strategy.",
    "If you could not confirm what they sell, to whom, and the offer, end with two or three short questions; otherwise end with one plain sentence on what stood out.",
    "The Brand Brain card is your report: do not call report_update, and never mention tool limits or what you may not do this turn.",
  ].join("\n");
}

const ONBOARDING_TURN_PREFIX = "cmo:onboarding:";
const STRATEGY_TURN_PREFIX = "cmo:strategy:";

function tomorrow(now: Date = new Date()): string {
  return new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
}
/**
 * Learning that shows no progress for this long is stuck: a healthy turn
 * writes an event every few seconds and ends within the runtime's budget.
 */
const LEARNING_STALL_MS = 5 * 60 * 1_000;

/** Where Cuso's first look at the business stands, for the learning card. */
export type CmoLearningState = "running" | "failed" | "done";

async function lastTurnProgressAt(turn: {
  eveSessionId: string | null;
  createdAt: Date;
}): Promise<Date> {
  if (!turn.eveSessionId) return turn.createdAt;
  const latest = await prisma.sokoBotRuntimeEvent.findFirst({
    where: { sessionId: turn.eveSessionId },
    orderBy: { startIndex: "desc" },
    select: { occurredAt: true },
  });
  return latest?.occurredAt ?? turn.createdAt;
}

/**
 * Reads the newest onboarding turn. A stuck one (its run died, e.g. with
 * the process that ran it) is settled as failed here, as a deadline would,
 * so the founder sees "Try again" instead of a spinner and the bot is free
 * for new turns.
 */
type TurnRow = {
  id: string;
  status: string;
  eveSessionId: string | null;
  createdAt: Date;
  clientTurnId: string | null;
};

/**
 * running, done or failed. A turn that stopped making progress (its run died
 * with the process that ran it) is settled as failed here, as a deadline
 * would, so the founder sees "Try again" instead of a spinner.
 */
async function settledTurnStatus(
  turn: TurnRow,
  now: Date,
): Promise<CmoLearningState> {
  if (turn.status === "COMPLETED") return "done";
  if (turn.status === "FAILED" || turn.status === "CANCELLED") return "failed";
  const progressAt = await lastTurnProgressAt(turn);
  if (now.getTime() - progressAt.getTime() < LEARNING_STALL_MS) {
    return "running";
  }
  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  await sokoBotControlPlane.expireTurn(turn.id).catch(() => undefined);
  return "failed";
}

const TURN_ROW_SELECT = {
  id: true,
  status: true,
  eveSessionId: true,
  createdAt: true,
  clientTurnId: true,
} as const;

export async function cmoLearningState(
  workspace: Pick<CmoWorkspace, "userId" | "sokoBotId" | "brandBrain">,
  now: Date = new Date(),
): Promise<CmoLearningState> {
  if (workspace.brandBrain) return "done";
  const turn = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: workspace.sokoBotId,
      clientTurnId: { startsWith: ONBOARDING_TURN_PREFIX },
    },
    orderBy: { createdAt: "desc" },
    select: TURN_ROW_SELECT,
  });
  // Cuso can finish without a Brand Brain on purpose: it asked questions.
  return turn ? settledTurnStatus(turn, now) : "failed";
}

/** One thing Cuso did while researching or planning, for the live feed. */
export interface CmoWorkStep {
  id: string;
  kind: "search" | "read" | "study" | "brain" | "strategy" | "other";
  label: string;
  url: string | null;
  status: "running" | "done" | "failed";
  at: Date;
}

export interface CmoWork {
  kind: "research" | "strategy";
  status: CmoLearningState;
  startedAt: Date;
  steps: CmoWorkStep[];
}

function hostOf(value: string): string | null {
  try {
    return new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    ).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A tool call as the founder reads it: "Reading linear.app/pricing". */
export function describeCmoStep(
  capability: string,
  input: unknown,
  siteUrl: string,
): Pick<CmoWorkStep, "kind" | "label" | "url"> | null {
  const fields =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (capability === "web_search" && typeof fields.query === "string") {
    return {
      kind: "search",
      label: `Searching “${clip(fields.query.replace(/site:\S+/g, "").trim(), 60)}”`,
      url: null,
    };
  }
  if (capability === "web_fetch" && typeof fields.url === "string") {
    const host = hostOf(fields.url);
    if (!host) return null;
    let path = "";
    try {
      path = new URL(fields.url).pathname.replace(/\/$/, "");
    } catch {
      path = "";
    }
    const own = host === hostOf(siteUrl);
    return {
      kind: own ? "read" : "study",
      label: own ? `Reading ${host}${clip(path, 30)}` : `Studying ${host}`,
      url: fields.url,
    };
  }
  if (capability === "save_brand_brain") {
    return { kind: "brain", label: "Writing your Brand Brain", url: null };
  }
  if (capability === "save_strategy") {
    return { kind: "strategy", label: "Writing your strategy", url: null };
  }
  if (capability === "list_project_social_accounts") {
    return { kind: "other", label: "Checking your accounts", url: null };
  }
  return null;
}

/** Cuso's latest research or strategy turn, step by step. */
export async function cmoWork(
  workspace: Pick<CmoWorkspace, "sokoBotId" | "websiteUrl">,
  now: Date = new Date(),
): Promise<CmoWork | null> {
  const turn = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: workspace.sokoBotId,
      OR: [
        { clientTurnId: { startsWith: ONBOARDING_TURN_PREFIX } },
        { clientTurnId: { startsWith: STRATEGY_TURN_PREFIX } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: TURN_ROW_SELECT,
  });
  if (!turn) return null;
  const calls = await prisma.sokoBotToolCall.findMany({
    where: { turnId: turn.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      capability: true,
      input: true,
      status: true,
      createdAt: true,
    },
    take: 60,
  });
  const steps = calls.flatMap((call): CmoWorkStep[] => {
    const described = describeCmoStep(
      call.capability,
      call.input,
      workspace.websiteUrl,
    );
    if (!described) return [];
    return [
      {
        id: call.id,
        ...described,
        status:
          call.status === "COMPLETED"
            ? "done"
            : call.status === "FAILED"
              ? "failed"
              : "running",
        at: call.createdAt,
      },
    ];
  });
  return {
    kind: turn.clientTurnId?.startsWith(STRATEGY_TURN_PREFIX)
      ? "strategy"
      : "research",
    status: await settledTurnStatus(turn, now),
    startedAt: turn.createdAt,
    steps,
  };
}

/**
 * Pages of CMO.xyz itself: social connect may send the owner back there and
 * nowhere else. Local CMO runs on localhost in development.
 */
export function isCmoAppUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol === "https:") {
    return host === "cmo.xyz" || host.endsWith(".cmo.xyz");
  }
  return (
    getEnv().NODE_ENV === "development" &&
    url.protocol === "http:" &&
    isLocalDevHostname(host)
  );
}

/**
 * Starts connecting one of the strategy's networks to Cuso's Project through
 * Sokosumi's Project social flow; the provider returns to CMO afterwards.
 */
export async function connectCmoChannel(input: {
  userId: string;
  provider: ProjectSocialProvider;
  callbackUrl: string;
}): Promise<{ redirectUrl: string }> {
  if (!isCmoAppUrl(input.callbackUrl)) {
    throw new CmoConflictError("Unknown return address");
  }
  const workspace = await getCmoWorkspaceForUser(input.userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace yet");
  const { initiateProjectSocialConnection } = await import(
    "@/services/project-social-connections.service"
  );
  const { redirectUrl } = await initiateProjectSocialConnection({
    projectId: workspace.projectId,
    workspaceId: workspace.workspaceId,
    userId: input.userId,
    action: "connect",
    provider: input.provider,
    callbackUrl: input.callbackUrl,
  });
  return { redirectUrl };
}

/** Finishes a connection the provider just confirmed. */
export async function finalizeCmoChannel(input: {
  userId: string;
  connectionId: string;
}): Promise<void> {
  const workspace = await getCmoWorkspaceForUser(input.userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace yet");
  const { finalizeProjectSocialConnection } = await import(
    "@/services/project-social-connections.service"
  );
  await finalizeProjectSocialConnection({
    projectId: workspace.projectId,
    workspaceId: workspace.workspaceId,
    userId: input.userId,
    connectionId: input.connectionId,
  });
}

/** The founder connected or skipped the Accounts step; a reload resumes on the plan. */
export async function finishCmoAccountsStep(userId: string): Promise<void> {
  const workspace = await getCmoWorkspaceForUser(userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace yet");
  if (!workspace.strategyApprovedAt) {
    throw new CmoConflictError("Approve the strategy first");
  }
  if (workspace.accountsDoneAt) return;
  await prisma.cmoWorkspace.update({
    where: { id: workspace.id },
    data: { accountsDoneAt: new Date() },
  });
}

/** The founder finished onboarding: CMO opens on the chat from now on. */
export async function completeCmoOnboarding(userId: string): Promise<void> {
  const workspace = await getCmoWorkspaceForUser(userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace yet");
  if (!workspace.strategyApprovedAt) {
    throw new CmoConflictError("Approve the strategy first");
  }
  if (workspace.onboardedAt) return;
  await prisma.cmoWorkspace.update({
    where: { id: workspace.id },
    data: { onboardedAt: new Date() },
  });
}

/** Starts learning again after a failed or stuck first look. */
export async function retryCmoOnboarding(
  userId: string,
): Promise<{ turnId: string }> {
  const workspace = await getCmoWorkspaceForUser(userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace yet");
  const state = await cmoLearningState(workspace);
  if (state !== "failed") {
    throw new CmoConflictError(
      state === "running"
        ? "Cuso is still learning the business"
        : "Cuso already learned the business",
    );
  }
  if (!workspace.brandVisual) {
    waitUntil(learnCmoBrandVisual(workspace).catch(() => undefined));
  }
  return startCmoTurn(workspace, {
    clientTurnId: `${ONBOARDING_TURN_PREFIX}${workspace.id}:${Date.now()}`,
    message: onboardingMessage(workspace),
    route: CMO_ONBOARDING_ROUTE,
  });
}

/**
 * Creates the business's organization, its marketing Project and Cuso, then
 * starts Cuso's first turn. One CMO workspace per person; a second call
 * returns the existing one.
 */
export async function startCmoOnboarding(input: {
  userId: string;
  websiteUrl: string;
  goals: string;
  businessName?: string;
}): Promise<CmoWorkspace> {
  const existing = await getCmoWorkspaceForUser(input.userId);
  if (existing) return existing;

  const businessName =
    input.businessName?.trim() || cmoBusinessNameFromUrl(input.websiteUrl);
  // Cuso works in the owner's own workspace, in one Project of his own, so
  // everything he does is already organised when they open Sokosumi.
  const { workspaceRepository } = await import(
    "@sokosumi/database/repositories"
  );
  const { workspace } = await prisma.$transaction((tx) =>
    workspaceRepository.ensurePersonalWorkspaceKeepingPreferred({
      userId: input.userId,
      tx,
    }),
  );

  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      name: cmoProjectName(businessName),
      websiteUrl: input.websiteUrl,
    },
    select: { id: true },
  });

  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  const bot = await sokoBotControlPlane.create({
    userId: input.userId,
    workspaceId: workspace.id,
    projectId: project.id,
    name: CUSO_NAME,
    versionId: CMO_SOKO_BOT_VERSION_ID,
  });

  const created = await prisma.cmoWorkspace.create({
    data: {
      userId: input.userId,
      workspaceId: workspace.id,
      sokoBotId: bot.id,
      projectId: project.id,
      businessName,
      websiteUrl: input.websiteUrl,
      goals: input.goals,
    },
  });

  // The brand's look (logo, colours, fonts, DESIGN.md) is read alongside
  // Cuso's research; it never holds up onboarding.
  waitUntil(
    learnCmoBrandVisual(created).catch((error) => {
      console.warn("CMO brand visual failed", {
        cmoWorkspaceId: created.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }),
  );

  // A turn that cannot start (no credits yet) leaves the workspace ready:
  // the learning card offers Try again and says why when it fails again.
  await startCmoTurn(created, {
    clientTurnId: `${ONBOARDING_TURN_PREFIX}${created.id}`,
    message: onboardingMessage({
      businessName,
      websiteUrl: input.websiteUrl,
      goals: input.goals,
    }),
    route: CMO_ONBOARDING_ROUTE,
  }).catch((error) => {
    console.warn("CMO onboarding turn did not start", {
      cmoWorkspaceId: created.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  });

  return created;
}

/** Asks Cuso for a new one-month strategy; the owner approves it again. */
export async function requestCmoStrategy(input: {
  userId: string;
  note?: string;
}): Promise<{ turnId: string }> {
  const workspace = await getCmoWorkspaceForUser(input.userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace");
  if (!parseCmoBrandBrain(workspace.brandBrain)) {
    throw new CmoConflictError("Cuso is still building the Brand Brain");
  }
  await prisma.cmoWorkspace.update({
    where: { id: workspace.id },
    data: { strategyApprovedAt: null },
  });
  return startCmoTurn(workspace, {
    clientTurnId: `${STRATEGY_TURN_PREFIX}${workspace.id}:${Date.now()}`,
    message: [
      `Write ${workspace.businessName}'s marketing strategy for the next four weeks, starting ${tomorrow()}.`,
      `Their main goal, in their words: ${workspace.goals}`,
      input.note
        ? `Change request from the owner: ${input.note}\nKeep what still works, change what they asked, and list each difference in changes.`
        : "",
      "",
      "Follow your strategy skill exactly. Use the Brand Brain and the channels in your packet. Save the whole strategy with save_strategy: an exact day-by-day calendar (date, time, channel, format, hook, why), full drafts for every entry in the first week, the why for the plan and for each channel, and previews (an ad, an SEO article and a newsletter in the brand's voice, plus one post).",
      "Do not create Social posts or images yet; that starts after the owner approves.",
      "Then tell the owner in one or two sentences what the plan does first. The strategy card is your report: do not call report_update.",
    ]
      .filter(Boolean)
      .join("\n"),
    route: CMO_STRATEGY_ROUTE,
  });
}

export async function saveCmoBrandBrain(
  where: { userId: string } | { sokoBotId: string },
  brandBrain: CmoBrandBrain,
): Promise<CmoWorkspace> {
  const parsed = cmoBrandBrainSchema.parse(brandBrain);
  const current = await prisma.cmoWorkspace.findUnique({
    where,
    select: { id: true },
  });
  if (!current) throw new CmoNotFoundError("No CMO workspace");
  return prisma.cmoWorkspace.update({
    where: { id: current.id },
    data: {
      brandBrain: parsed as Prisma.InputJsonValue,
      brandBrainUpdatedAt: new Date(),
    },
  });
}

const STRATEGY_HISTORY_LIMIT = 8;

const strategyHistorySchema = z.array(
  z.object({
    savedAt: z.string(),
    turnId: z.string().nullable(),
    strategy: z.unknown(),
  }),
);
type StrategyHistory = z.infer<typeof strategyHistorySchema>;

function parseHistory(value: unknown): StrategyHistory {
  const parsed = strategyHistorySchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * Saves the strategy. The strategy it replaces goes into a short history so
 * a weekly change can be reverted. The owner's approval carries over: after
 * approving once, the owner expects Cuso to keep the plan current.
 */
export async function saveCmoStrategy(
  where: { userId: string } | { sokoBotId: string },
  strategy: CmoStrategy,
  options: { turnId?: string } = {},
): Promise<CmoWorkspace> {
  const parsed = cmoStrategySchema.parse(strategy);
  const current = await prisma.cmoWorkspace.findUnique({ where });
  if (!current) throw new CmoNotFoundError("No CMO workspace");
  const history = current.strategy
    ? [
        {
          savedAt: (current.strategyUpdatedAt ?? new Date()).toISOString(),
          turnId: options.turnId ?? null,
          strategy: current.strategy,
        },
        ...parseHistory(current.strategyHistory),
      ].slice(0, STRATEGY_HISTORY_LIMIT)
    : parseHistory(current.strategyHistory);
  return prisma.cmoWorkspace.update({
    where: { id: current.id },
    data: {
      strategy: parsed as Prisma.InputJsonValue,
      strategyUpdatedAt: new Date(),
      strategyHistory: history as Prisma.InputJsonValue,
    },
  });
}

/** The owner's one approval: from now on Cuso executes the strategy. */
export async function approveCmoStrategy(
  userId: string,
): Promise<CmoWorkspace> {
  const workspace = await getCmoWorkspaceForUser(userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace");
  if (!parseCmoStrategy(workspace.strategy)) {
    throw new CmoConflictError("There is no strategy to approve yet");
  }
  return prisma.cmoWorkspace.update({
    where: { id: workspace.id },
    data: { strategyApprovedAt: workspace.strategyApprovedAt ?? new Date() },
  });
}

const cmoUpdateRecordSchema = cmoReportUpdateInputSchema.extend({
  id: z.string(),
  at: z.string(),
  /** Weekly and monthly: the strategy before this turn's changes, for revert. */
  previousStrategy: z.unknown().optional(),
  revertedAt: z.string().optional(),
});
export type CmoUpdateRecord = z.infer<typeof cmoUpdateRecordSchema>;

const UPDATES_LIMIT = 60;

export function parseCmoUpdates(value: unknown): CmoUpdateRecord[] {
  const parsed = z.array(cmoUpdateRecordSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * Stores Cuso's report as a chat card. A weekly report keeps the strategy as
 * it was before the first save of the same turn, so the owner can revert the
 * whole review in one step.
 */
export async function reportCmoUpdate(input: {
  sokoBotId: string;
  turnId: string;
  update: CmoReportUpdateInput;
}): Promise<CmoUpdateRecord> {
  const workspace = await getCmoWorkspaceForBot(input.sokoBotId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace");
  const update = cmoReportUpdateInputSchema.parse(input.update);
  const savedThisTurn = parseHistory(workspace.strategyHistory).filter(
    (entry) => entry.turnId === input.turnId,
  );
  const record: CmoUpdateRecord = {
    ...update,
    id: randomBytes(8).toString("hex"),
    at: new Date().toISOString(),
    ...((update.kind === "weekly" || update.kind === "monthly") &&
    savedThisTurn.length > 0
      ? { previousStrategy: savedThisTurn[savedThisTurn.length - 1]?.strategy }
      : {}),
  };
  await prisma.cmoWorkspace.update({
    where: { id: workspace.id },
    data: {
      updates: [record, ...parseCmoUpdates(workspace.updates)].slice(
        0,
        UPDATES_LIMIT,
      ) as Prisma.InputJsonValue,
    },
  });
  return record;
}

/**
 * The owner pauses one calendar entry from Up next: its scheduled post is
 * canceled so it cannot go out, and the entry leaves the plan (skipped).
 */
export async function pauseCmoCalendarEntry(input: {
  userId: string;
  entryId: string;
}): Promise<void> {
  const workspace = await getCmoWorkspaceForUser(input.userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace");
  const strategy = parseCmoStrategy(workspace.strategy);
  const entry = strategy?.calendar.find((item) => item.id === input.entryId);
  if (!strategy || !entry) {
    throw new CmoNotFoundError("No such calendar entry");
  }
  if (entry.socialPostId) {
    const post = await prisma.socialPost.findFirst({
      where: { id: entry.socialPostId, projectId: workspace.projectId },
      select: { status: true, revision: true },
    });
    if (post && (post.status === "DRAFT" || post.status === "SCHEDULED")) {
      const { cancelSocialPost } = await import(
        "@/services/social-posts.service"
      );
      await cancelSocialPost({
        projectId: workspace.projectId,
        workspaceId: workspace.workspaceId,
        userId: input.userId,
        postId: entry.socialPostId,
        revision: post.revision,
      });
    }
  }
  await saveCmoStrategy(
    { userId: input.userId },
    {
      ...strategy,
      calendar: strategy.calendar.map((item) =>
        item.id === entry.id ? { ...item, status: "skipped" as const } : item,
      ),
    },
  );
}

/** Puts back the strategy a weekly review or monthly strategy replaced. */
export async function revertCmoUpdate(input: {
  userId: string;
  updateId: string;
}): Promise<CmoWorkspace> {
  const workspace = await getCmoWorkspaceForUser(input.userId);
  if (!workspace) throw new CmoNotFoundError("No CMO workspace");
  const updates = parseCmoUpdates(workspace.updates);
  const target = updates.find((update) => update.id === input.updateId);
  const previous = parseCmoStrategy(target?.previousStrategy);
  if (!target || !previous) {
    throw new CmoNotFoundError("Nothing to revert for this update");
  }
  if (target.revertedAt) return workspace;
  await saveCmoStrategy({ userId: input.userId }, previous);
  return prisma.cmoWorkspace.update({
    where: { id: workspace.id },
    data: {
      updates: updates.map((update) =>
        update.id === target.id
          ? { ...update, revertedAt: new Date().toISOString() }
          : update,
      ) as Prisma.InputJsonValue,
    },
  });
}

/**
 * Whether a CMO bot may schedule or publish. Null for bots that are not CMO
 * bots (no CMO rules apply) and when allowed: the owner approved the
 * strategy and the CMO subscription is active.
 */
export async function cmoExecutionRefusal(input: {
  sokoBotId: string;
  versionId: string | null;
}): Promise<string | null> {
  if (getSokoBotVersion(input.versionId).profile !== "cmo") return null;
  const workspace = await getCmoWorkspaceForBot(input.sokoBotId);
  if (!workspace) return null;
  const verdict = cmoMayExecute({
    approved: workspace.strategyApprovedAt !== null,
    subscribed: await hasActiveCmoSubscription(
      (await cmoPayer(workspace)).referenceId,
    ),
  });
  return verdict.ok ? null : verdict.reason;
}

/** The business's connected social accounts, from Project Social. */
export async function listCmoChannels(projectId: string) {
  const rows = await prisma.projectSocialConnection.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      externalHandle: true,
      displayName: true,
      status: true,
    },
  });
  // Project Social stores "active"; CMO reads statuses upper case.
  return rows.map((row) => ({ ...row, status: row.status.toUpperCase() }));
}

function calendarWindow(
  strategy: CmoStrategy,
  now: Date,
  days: number,
): CmoStrategy["calendar"] {
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return strategy.calendar.filter(
    (entry) => entry.date >= from && entry.date <= to,
  );
}

/**
 * What Cuso sees about the business on every turn: the Brand Brain, the
 * strategy with the next two weeks of the calendar, and whether it may
 * execute. Null for any bot that is not a CMO bot.
 */
export async function loadCmoMarketingContext(
  sokoBotId: string,
  now: Date = new Date(),
): Promise<Record<string, unknown> | null> {
  const workspace = await getCmoWorkspaceForBot(sokoBotId);
  if (!workspace) return null;
  const strategy = parseCmoStrategy(workspace.strategy);
  return {
    business: {
      name: workspace.businessName,
      websiteUrl: workspace.websiteUrl,
      goals: workspace.goals,
      marketingProjectId: workspace.projectId,
    },
    strategyApproved: workspace.strategyApprovedAt !== null,
    subscriptionActive: await hasActiveCmoSubscription(
      (await cmoPayer(workspace)).referenceId,
    ),
    connectedChannels: (await listCmoChannels(workspace.projectId)).map(
      (channel) => ({
        provider: channel.provider,
        handle: channel.externalHandle,
        status: channel.status,
        socialConnectionId: channel.id,
      }),
    ),
    brandBrain: parseCmoBrandBrain(workspace.brandBrain),
    /** The brand's logo, colours and fonts: use them in images and layouts. */
    brandVisual: parseCmoBrandVisual(workspace.brandVisual),
    strategy: strategy
      ? {
          ...strategy,
          // The whole four-week plan, so a revision keeps every entry.
          calendar: calendarWindow(strategy, now, 31),
          calendarTotal: strategy.calendar.length,
        }
      : null,
    recentUpdates: parseCmoUpdates(workspace.updates)
      .slice(0, 3)
      .map(({ previousStrategy: _previous, ...update }) => update),
  };
}

/** The packet appended to a CMO rhythm's prompt. */
export async function buildCmoBeatPacket(
  sokoBotId: string,
  now: Date,
  key: CmoSystemSchedule["key"],
): Promise<{ packet: string; skip: boolean }> {
  const workspace = await getCmoWorkspaceForBot(sokoBotId);
  if (!workspace) return { packet: "", skip: true };
  // Nothing runs without a reason: no approved strategy, no Brand Brain,
  // or not the reminder's one slot. A skipped run costs no turn.
  const skipReason = cmoRoutineSkipReason(key, {
    brandBrain: workspace.brandBrain !== null,
    strategySavedAt: workspace.strategy ? workspace.strategyUpdatedAt : null,
    strategyApproved: workspace.strategyApprovedAt !== null,
    now,
  });
  if (skipReason) return { packet: "", skip: true };
  const context = await loadCmoMarketingContext(sokoBotId, now);
  if (!context) return { packet: "", skip: true };
  const posts = workspace
    ? await prisma.socialPost.findMany({
        where: {
          projectId: workspace.projectId,
          updatedAt: { gte: new Date(now.getTime() - 14 * 86_400_000) },
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          provider: true,
          status: true,
          scheduledAt: true,
          publishedAt: true,
          publishedUrl: true,
          text: true,
        },
      })
    : [];
  const lines = [
    `## Execution: ${
      !context.strategyApproved
        ? "waiting for the owner to approve the strategy (draft only)"
        : context.subscriptionActive
          ? "active"
          : "paused: no CMO subscription (draft only)"
    }`,
    `## Connected channels: ${JSON.stringify(context.connectedChannels)}`,
    "",
    "## Brand Brain",
    JSON.stringify(context.brandBrain ?? "not built yet"),
    "",
    "## Strategy (calendar: next 14 days)",
    JSON.stringify(context.strategy ?? "no strategy yet"),
    "",
    "## Social posts, last 14 days",
    ...(posts.length
      ? posts.map(
          (post) =>
            `- ${post.status} · ${post.provider} · ${post.scheduledAt?.toISOString() ?? post.publishedAt?.toISOString() ?? "unscheduled"} · "${post.text.replace(/\s+/g, " ").slice(0, 80)}" (id ${post.id})${post.publishedUrl ? ` ${post.publishedUrl}` : ""}`,
        )
      : ["- none"]),
  ];
  return { packet: lines.join("\n"), skip: false };
}

export interface CmoUpNextItem {
  id: string;
  date: string;
  channel: string;
  title: string;
  status: string;
}

export interface CmoOverview {
  workspace: CmoWorkspace;
  /** The workspace's organization, when it is not the owner's personal one. */
  organizationSlug: string | null;
  projectName: string;
  learning: CmoLearningState;
  /** Cuso's latest research or strategy work, step by step. */
  work: CmoWork | null;
  brandVisual: CmoBrandVisual | null;
  /** The Project's logo (the site's best icon), when one was found. */
  projectLogo: string | null;
  /** What Cuso does when, for Settings. */
  routines: {
    key: string;
    name: string;
    when: string;
    description: string;
    nextRunAt: Date | null;
    /** The timezone "when" is in, so the next run reads the same way. */
    timezone: string | null;
  }[];
  roomId: string;
  subscriptionActive: boolean;
  brandBrain: CmoBrandBrain | null;
  strategy: CmoStrategy | null;
  botStatus: string;
  updates: CmoUpdateRecord[];
  channels: Awaited<ReturnType<typeof listCmoChannels>>;
  upNext: CmoUpNextItem[];
  connectChannelUrl: string;
  subscribeUrl: string;
  billing: {
    plan: string | null;
    subscriptionStatus: string | null;
    availableCredits: number;
  };
  /** Real post counts by status from Project Social; no invented metrics. */
  posts: Record<string, number>;
}

/**
 * What the "Up next" panel lists: the calendar's next open entries that Cuso
 * can actually execute, i.e. on a connected, active social account. Website,
 * newsletter and ads entries, and networks not connected yet, stay in the
 * Strategy calendar only.
 */
export function cmoUpNext(
  strategy: CmoStrategy | null,
  now: Date,
  connectedProviders: readonly string[],
  limit = 8,
): CmoUpNextItem[] {
  if (!strategy) return [];
  const today = now.toISOString().slice(0, 10);
  const executable = new Set(
    connectedProviders.map((provider) => provider.toLowerCase()),
  );
  return strategy.calendar
    .filter(
      (entry) =>
        entry.date >= today &&
        entry.status !== "published" &&
        entry.status !== "skipped" &&
        executable.has(entry.channel),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
    .map(({ id, date, channel, title, status }) => ({
      id,
      date,
      channel,
      title,
      status,
    }));
}

/** Everything the CMO app shows, in one read. Opens the owner's chat. */
export async function getCmoOverview(
  userId: string,
  now: Date = new Date(),
): Promise<CmoOverview | null> {
  const workspace = await getCmoWorkspaceForUser(userId);
  if (!workspace) return null;
  const payer = await cmoPayer(workspace);
  const [organization, project, bot, channels] = await Promise.all([
    payer.organizationId
      ? prisma.organization.findUnique({
          where: { id: payer.organizationId },
          select: { slug: true },
        })
      : null,
    prisma.project.findUnique({
      where: { id: workspace.projectId },
      select: { name: true, logo: true },
    }),
    prisma.sokoBot.findUnique({
      where: { id: workspace.sokoBotId },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        status: true,
        workspace: { select: { organizationId: true } },
      },
    }),
    listCmoChannels(workspace.projectId),
  ]);
  const postGroups = await prisma.socialPost.groupBy({
    by: ["status"],
    where: { projectId: workspace.projectId },
    _count: { _all: true },
  });
  if (!bot || !project) return null;
  const { findOrOpenOwnerDirectRoom } = await import(
    "@/services/soko-bot-chat.service"
  );
  const room = await findOrOpenOwnerDirectRoom(bot);
  const strategy = parseCmoStrategy(workspace.strategy);
  const web = getWebAppBaseUrl().replace(/\/+$/, "");
  const credits = await buildCreditsPayload({
    userId,
    organizationId: payer.organizationId,
    referenceId: payer.referenceId,
    tx: prisma,
  });
  const cmoPlan = await activeCmoPlan(payer.referenceId);
  const learning = await cmoLearningState(workspace, now);
  const work = await cmoWork(workspace, now);
  const schedules = await prisma.sokoBotSchedule.findMany({
    where: { sokoBotId: workspace.sokoBotId, systemKey: { not: null } },
    select: {
      systemKey: true,
      nextRunAt: true,
      enabled: true,
      timezone: true,
    },
  });
  const routines = SOKO_BOT_CMO_SCHEDULES.map((routine) => {
    const row = schedules.find((s) => s.systemKey === routine.key);
    return {
      key: routine.key,
      name: routine.name,
      when: routine.when,
      description: routine.description,
      nextRunAt: row?.enabled ? row.nextRunAt : null,
      timezone: row?.timezone ?? null,
    };
  });
  return {
    workspace,
    learning,
    work,
    brandVisual: parseCmoBrandVisual(workspace.brandVisual),
    projectLogo: project.logo,
    routines,
    organizationSlug: organization?.slug ?? null,
    projectName: project.name,
    roomId: room.id,
    subscriptionActive: cmoPlan !== null,
    brandBrain: parseCmoBrandBrain(workspace.brandBrain),
    strategy,
    botStatus: bot.status,
    updates: parseCmoUpdates(workspace.updates),
    channels,
    upNext: cmoUpNext(
      strategy,
      now,
      channels
        .filter((channel) => channel.status === "ACTIVE")
        .map((channel) => channel.provider),
    ),
    // Connecting an account is a human OAuth step in Sokosumi's Social page.
    connectChannelUrl: `${web}/social?projectId=${workspace.projectId}`,
    // TODO(cmo): a CMO plan checkout; Sokosumi's billing page until then.
    subscribeUrl: `${web}/billing`,
    billing: {
      // The plan that gates Cuso first; otherwise whatever the org is on.
      plan: cmoPlan ?? credits.subscription?.plan ?? null,
      subscriptionStatus: credits.subscription?.status ?? null,
      availableCredits: credits.spendable,
    },
    posts: Object.fromEntries(
      postGroups.map((group) => [group.status, group._count._all]),
    ),
  };
}
