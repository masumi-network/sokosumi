import { randomBytes } from "node:crypto";
import { type CmoHire, MemberRole, type Prisma } from "@sokosumi/database";
import {
  CMO_BRAND_SECTION_KEYS,
  CMO_BRAND_SECTIONS,
  CMO_MEASUREMENT_SOURCES,
  CMO_SOKO_BOT_VERSION_ID,
  type CmoBrandAnswer,
  type CmoBrandBrain,
  type CmoBrandFinding,
  type CmoBrandProfile,
  type CmoBrandQuestion,
  type CmoBrandSectionKey,
  type CmoMeasurementSource,
  type CmoPlanQuestion,
  type CmoReportUpdateInput,
  type CmoSaveBrandBrainInput,
  type CmoStrategy,
  type CmoStrategySave,
  type CmoSystemSchedule,
  cmoBrandBrainSchema,
  cmoBrandProfileSchema,
  cmoMayExecute,
  cmoReportUpdateInputSchema,
  cmoRoutineSkipReason,
  cmoSaveBrandBrainInputSchema,
  cmoStrategySchema,
  getSokoBotVersion,
  isCmoMeasurementSource,
  SOKO_BOT_CMO_SCHEDULES,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { isFirstPartyAppUrl } from "@/config/cors-allow-origin";
import {
  getEnv,
  getWebAppBaseUrl,
  isProductionEnvironment,
} from "@/config/env";
import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import { buildCreditsPayload } from "@/helpers/subscription";
import { getUserWorkspace } from "@/helpers/user-workspaces";
import {
  type BrandVisual,
  brandColors,
  brandFontName,
  distinctColors,
  readBrandVisual,
} from "@/lib/brand-visual";
import prisma from "@/lib/db/prisma";
import { uploadDesignMdContent } from "@/lib/design-md-blob";
import { decodeEntities } from "@/lib/open-graph-html";
import { resolveSiteIconAsProjectLogo } from "@/lib/site-icon";
import type { PresetRoute } from "@/lib/soko-bot/classifier";
import { parseCmoBrandMedia } from "@/services/cmo-brand-media.service";
import {
  type CmoCalendarMedia,
  cmoCalendarMedia,
} from "@/services/cmo-media.service";
import { contactListNameKey } from "@/services/contact-lists.service";

/**
 * CMO.xyz (Cuso) on Soko Bots. Cuso works in the Workspace the person chose
 * (ADR 0053), as an ordinary Soko Bot in a Project of his own, so every
 * existing seam — turns, schedules, chat, Social, Content Studio, Tasks —
 * works unchanged. This module adds what CMO needs on
 * top: onboarding, the Brand Brain and strategy records, the subscription
 * gate, and the packets Cuso's rhythms read.
 */

export class CmoNotFoundError extends Error {}
export class CmoConflictError extends Error {}
export class CmoForbiddenError extends Error {}

const CUSO_NAME = "Cuso";

/** Onboarding and strategy turns: owner asked, full work route. */
const CMO_ONBOARDING_ROUTE: PresetRoute = {
  route: "MANAGE_WORK",
  writeScope: "WORK",
  sandbox: true,
  reason: "CMO onboarding: learn the business and build the Brand Brain.",
};
/**
 * No sandbox on the strategy turn: it plans from the Brand Brain it already
 * has. It writes no drafts or Social posts; after the owner approves, the
 * daily run drafts each piece three days before it goes out.
 */
const CMO_STRATEGY_ROUTE: PresetRoute = {
  route: "MANAGE_WORK",
  writeScope: "WORK",
  reason: "CMO strategy: plan the next four weeks.",
};

export const cmoBrandVisualSchema = z.object({
  logoUrl: z.string().url().nullable(),
  colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/)).max(8),
  fonts: z.array(z.string().max(80)).max(4),
  siteName: z.string().max(120).nullable(),
  designMdUrl: z.string().url().nullable(),
  images: z.array(z.string().url()).max(8).default([]),
});
export type CmoBrandVisual = z.infer<typeof cmoBrandVisualSchema>;

export function parseCmoBrandVisual(value: unknown): CmoBrandVisual | null {
  const parsed = cmoBrandVisualSchema.safeParse(value);
  if (!parsed.success) return null;
  // Rows saved before the filters tightened still carry fallbacks, icon
  // fonts, near-repeat colours and raw entities.
  const fonts = parsed.data.fonts
    .map(brandFontName)
    .filter((font): font is string => font !== null);
  return {
    ...parsed.data,
    colors: distinctColors(parsed.data.colors),
    fonts: [...new Set(fonts)],
    siteName: parsed.data.siteName
      ? decodeEntities(parsed.data.siteName)
      : null,
  };
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
  // The homepage describes the brand; an entered subpage ("/pages/about")
  // named the file after that page.
  let result = await client.submit({
    url: new URL("/", websiteUrl).toString(),
  });
  const deadline = Date.now() + DESIGN_MD_BUDGET_MS;
  while (
    result.isOk() &&
    (result.value.status === "queued" || result.value.status === "running") &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, DESIGN_MD_POLL_MS));
    result = await client.pollJob(result.value.jobId);
  }
  if (result.isErr() || result.value.status !== "done") {
    console.warn("CMO DESIGN.md not generated", {
      projectId,
      reason: result.isErr() ? result.error.type : result.value.status,
    });
    return null;
  }
  const done = result.value;
  const extractionId =
    done.extractionId === null ? null : String(done.extractionId);
  const stored = await uploadDesignMdContent({
    content: done.designMd,
    owner: { kind: "project", id: projectId },
    extractionId,
  });
  if (!stored) return null;
  await prisma.project.update({
    where: { id: projectId },
    data: {
      designMdUrl: stored,
      designMdExtractionId: extractionId,
    },
  });
  return { url: stored, content: done.designMd };
}

/**
 * Reads how the brand looks and keeps it on the CMO hire: the logo (the
 * site's own, else its best icon stored as the Project logo), colours, fonts
 * and, when the API is configured, a DESIGN.md on the Project.
 */
export async function learnCmoBrandVisual(
  hire: Pick<CmoHire, "id" | "projectId" | "websiteUrl">,
): Promise<CmoBrandVisual> {
  const [site, icon, designMd] = await Promise.all([
    readBrandVisual(hire.websiteUrl),
    resolveSiteIconAsProjectLogo(hire.websiteUrl, hire.projectId)
      .then(async (logo) => {
        if (logo) {
          await prisma.project.update({
            where: { id: hire.projectId },
            data: { logo },
          });
        }
        return logo;
      })
      .catch(() => null),
    generateProjectDesignMd(hire.projectId, hire.websiteUrl).catch(() => null),
  ]);
  const visual = mergeBrandVisual(site, icon, designMd);
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { brandVisual: visual },
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
    colors: distinctColors([...designColors, ...site.colors]).slice(0, 5),
    fonts: site.fonts,
    siteName: site.siteName,
    designMdUrl: designMd?.url ?? null,
    images: site.images,
  };
}

/** The Project's name in Sokosumi: "CMO.xyz · Acme". */
export function cmoProjectName(businessName: string): string {
  return `CMO.xyz · ${businessName}`.slice(0, 120);
}

/**
 * Who pays for Cuso and whose plan opens execution: the business's
 * organization, which every hire gets (ADR 0060).
 */
async function cmoPayer(
  hire: Pick<CmoHire, "workspaceId">,
): Promise<{ organizationId: string; referenceId: string }> {
  const row = await prisma.workspace.findUnique({
    where: { id: hire.workspaceId },
    select: { organizationId: true },
  });
  if (!row?.organizationId)
    throw new Error("Cuso's workspace has no organization");
  return {
    organizationId: row.organizationId,
    referenceId: row.organizationId,
  };
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

/**
 * The Cuso this person works with (ADR 0061): the live hire in their preferred
 * organization, which hiring made preferred, else the newest live hire of any
 * organization they belong to. A deleted or archived Cuso hired no one.
 */
export async function getCmoHireForUser(
  userId: string,
): Promise<CmoHire | null> {
  const [user, hires] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { preferredOrganizationId: true },
    }),
    prisma.cmoHire.findMany({
      where: {
        sokoBot: { deletedAt: null, archivedAt: null },
        project: {
          workspace: { organization: { members: { some: { userId } } } },
        },
      },
      include: {
        project: {
          select: { workspace: { select: { organizationId: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const found =
    hires.find(
      (hire) =>
        hire.project.workspace.organizationId === user?.preferredOrganizationId,
    ) ?? hires[0];
  if (!found) return null;
  const { project: _project, ...hire } = found;
  return hire;
}

export async function getCmoHireForBot(
  sokoBotId: string,
): Promise<CmoHire | null> {
  return prisma.cmoHire.findUnique({ where: { sokoBotId } });
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

/** CMO_MOCK_BILLING, which production ignores so a stray value cannot make plans free. */
function cmoMockBilling(): boolean {
  const env = getEnv();
  return env.CMO_MOCK_BILLING && !isProductionEnvironment(env);
}

/** The CMO tier picked without billing; ignored unless mock billing is on. */
export function cmoMockPlan(hire: Pick<CmoHire, "mockPlan">): string | null {
  return cmoMockBilling() ? hire.mockPlan : null;
}

/** A mock plan (when allowed) or a real paid plan lets Cuso execute. */
export async function isCmoSubscribed(
  hire: Pick<CmoHire, "workspaceId" | "mockPlan">,
): Promise<boolean> {
  if (cmoMockPlan(hire)) return true;
  return hasActiveCmoSubscription((await cmoPayer(hire)).referenceId);
}

/**
 * Approving the strategy and starting the paid month spend the business's
 * money and publish in its name: the organization's owners and admins only
 * (ADR 0061). Every other member works with Cuso freely.
 */
async function mayCommitCmo(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const member = await prisma.member.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });
  return member !== null && isOrganizationOwnerOrAdmin(member.role);
}

async function requireCmoCommitter(
  userId: string,
  hire: Pick<CmoHire, "workspaceId">,
): Promise<void> {
  const { organizationId } = await cmoPayer(hire);
  if (!(await mayCommitCmo(userId, organizationId))) {
    throw new CmoForbiddenError(
      "Only the organization's owners and admins approve Cuso's plan and start his month",
    );
  }
}

/** Activates a CMO tier without checkout, on local and preview runs only. */
export async function chooseCmoMockPlan(
  userId: string,
  plan: string,
): Promise<void> {
  if (!cmoMockBilling()) {
    throw new CmoConflictError("Mock billing is off on this server");
  }
  const hire = await getCmoHireForUser(userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  await requireCmoCommitter(userId, hire);
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { mockPlan: plan, mockPlanActivatedAt: new Date() },
  });
  await startCmoProduction(hire.id);
}

/** Paid and approved: Cuso makes the whole month now (cmo-production.service). */
async function startCmoProduction(hireId: string): Promise<void> {
  const { kickCmoProduction } = await import(
    "@/services/cmo-production.service"
  );
  kickCmoProduction(hireId);
}

/** What the founder reads when a step cannot start for lack of credits. */
export const CMO_OUT_OF_CREDITS = "You're out of credits";

/**
 * Before hiring: whether the payer can fund Cuso's first turn, so research
 * never starts only to stop on credits.
 */
async function canFundFirstTurn(input: {
  userId: string;
  organizationId: string | null;
}): Promise<boolean> {
  const credits = await buildCreditsPayload({
    userId: input.userId,
    organizationId: input.organizationId,
    referenceId: input.organizationId ?? input.userId,
    tx: prisma,
  });
  return credits.spendable >= getEnv().SOKO_BOT_MIN_TURN_CREDITS;
}

/** A turn of Cuso's that `userId`, a member of his organization, started. */
async function startCmoTurn(
  hire: Pick<CmoHire, "workspaceId" | "sokoBotId">,
  userId: string,
  input: { clientTurnId: string; message: string; route: PresetRoute },
): Promise<{ turnId: string }> {
  // The founder pressed the button and sees the refusal there, so the
  // control plane's out-of-credits chat notice would only repeat it.
  const { requireSokoBotTurnFunding, SokoBotBillingAccessError } = await import(
    "@/services/soko-bot-billing.service"
  );
  try {
    await requireSokoBotTurnFunding(userId, hire.sokoBotId);
  } catch (error) {
    if (error instanceof SokoBotBillingAccessError) {
      throw new CmoConflictError(CMO_OUT_OF_CREDITS);
    }
    throw error;
  }
  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  const started = await sokoBotControlPlane.startTurn({
    userId,
    workspaceId: hire.workspaceId,
    // Cuso, never the member's personal assistant in the same workspace.
    sokoBotId: hire.sokoBotId,
    clientTurnId: input.clientTurnId,
    message: input.message,
    // A member pressed the button, but no chat message carries the turn:
    // EVENT delivers the answer to Cuso's shared room.
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
    ...(input.goals
      ? [`Their main marketing goal, in their words: ${input.goals}`]
      : []),
    "",
    "Learn the business and build its Brand Brain, following your Brand Brain skill: read the website, search for the company, its reviews, competitors, news and social profiles, and save each group of profile sections with save_brand_brain as soon as you have researched it, the essentials last. Write down only what you found, with the evidence, confidence, source and implication of every finding.",
    "Do not plan yet: the owner reviews the Brand Brain first, then asks you for the strategy.",
    "Put what you could not confirm into the Brand Brain's yes/no questions, never into chat. End with one plain sentence on what stood out.",
    "The Brand Brain card is your report: do not call report_update, and never mention tools, tool limits or what you may not do this turn.",
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
  hire: Pick<CmoHire, "sokoBotId" | "brandBrain">,
  now: Date = new Date(),
): Promise<CmoLearningState> {
  if (parseCmoBrandBrain(hire.brandBrain)) return "done";
  const turn = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: hire.sokoBotId,
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
  sectionsSaved: number;
  sectionsTotal: number;
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
  if (capability === "read_social_profile" && typeof fields.url === "string") {
    const url = URL.parse(fields.url);
    return {
      kind: "read",
      label: `Looking at ${url ? `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}` : "a profile"}`,
      url: fields.url,
    };
  }
  if (capability === "web_search" && typeof fields.query === "string") {
    return {
      kind: "search",
      label: `Searching “${clip(
        fields.query
          .replace(/site:\S+/g, "")
          .replace(/["“”]/g, "")
          .replace(/(^|\s)(?:OR|AND)(?=\s|$)/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
        60,
      )}”`,
      url: null,
    };
  }
  if (capability === "search_exa" && typeof fields.query === "string") {
    const query = `“${clip(fields.query.replace(/["“”]/g, "").trim(), 60)}”`;
    const domains = Array.isArray(fields.includeDomains)
      ? fields.includeDomains.filter((domain) => typeof domain === "string")
      : [];
    const label =
      fields.category === "company"
        ? `Finding companies: ${query}`
        : fields.category === "news"
          ? `Reading the news: ${query}`
          : fields.category === "people"
            ? `Looking up people: ${query}`
            : domains.length > 0
              ? `Reading ${clip(domains.join(", "), 50)}`
              : `Searching ${query}`;
    return {
      kind: fields.category === "company" ? "study" : "search",
      label,
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
    const sections =
      fields.sections && typeof fields.sections === "object"
        ? CMO_BRAND_SECTION_KEYS.filter(
            (key) => key in (fields.sections as object),
          ).map((key) => CMO_BRAND_SECTIONS[key].title)
        : [];
    return {
      kind: "brain",
      label:
        sections.length > 0
          ? `Writing ${clip(sections.join(", "), 70)}`
          : "Writing your Brand Brain",
      url: null,
    };
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
  hire: Pick<CmoHire, "sokoBotId" | "websiteUrl" | "brandBrain">,
  now: Date = new Date(),
): Promise<CmoWork | null> {
  const turn = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: hire.sokoBotId,
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
      hire.websiteUrl,
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
    sectionsSaved: cmoBrandSectionsSaved(hire.brandBrain).length,
    sectionsTotal: CMO_BRAND_SECTION_KEYS.length,
  };
}

/** The founder connected or skipped the Accounts step; a reload resumes on the plan. */
export async function finishCmoAccountsStep(userId: string): Promise<void> {
  const hire = await getCmoHireForUser(userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  if (!hire.strategyApprovedAt) {
    throw new CmoConflictError("Approve the strategy first");
  }
  if (hire.accountsDoneAt) return;
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { accountsDoneAt: new Date() },
  });
}

/** The founder finished onboarding: CMO opens on the chat from now on. */
export async function completeCmoOnboarding(userId: string): Promise<void> {
  const hire = await getCmoHireForUser(userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  if (!hire.strategyApprovedAt) {
    throw new CmoConflictError("Approve the strategy first");
  }
  await startCmoProduction(hire.id);
  if (hire.onboardedAt) return;
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { onboardedAt: new Date() },
  });
}

/** Starts learning again after a failed or stuck first look. */
export async function retryCmoOnboarding(
  userId: string,
): Promise<{ turnId: string }> {
  const hire = await getCmoHireForUser(userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  const state = await cmoLearningState(hire);
  if (state !== "failed") {
    throw new CmoConflictError(
      state === "running"
        ? "Cuso is still learning the business"
        : "Cuso already learned the business",
    );
  }
  if (!hire.brandVisual) {
    waitUntil(learnCmoBrandVisual(hire).catch(() => undefined));
  }
  return startCmoResearch(hire, userId);
}

/**
 * Starts Cuso's research turn for a hire, as the member `userId`; the CMO lab
 * reruns it per brand.
 */
export function startCmoResearch(
  hire: CmoHire,
  userId: string,
): Promise<{ turnId: string }> {
  return startCmoTurn(hire, userId, {
    clientTurnId: `${ONBOARDING_TURN_PREFIX}${hire.id}:${Date.now()}`,
    message: onboardingMessage(hire),
    route: CMO_ONBOARDING_ROUTE,
  });
}

/**
 * Hires Cuso into a new organization named after the business (ADR 0060):
 * his marketing Project, Cuso as its shared bot (ADR 0061) and the CMO record
 * go there, and his first turn starts. A person who already works with a
 * live Cuso gets that hire back.
 */
export async function startCmoOnboarding(input: {
  userId: string;
  websiteUrl: string;
}): Promise<CmoHire> {
  const existing = await getCmoHireForUser(input.userId);
  if (existing) return existing;
  // shortcut: two racing submits can hire twice, in two organizations; the
  // start form submits once. Add a per-person lock if duplicates show up.

  // Organization names take 2 to 50 characters.
  const businessName = cmoBusinessNameFromUrl(input.websiteUrl)
    .slice(0, 50)
    .padEnd(2, ".");
  // A hire that failed after its organization existed left it empty; a
  // retry takes it instead of making a second one.
  const leftover = await prisma.organization.findFirst({
    where: {
      name: businessName,
      members: {
        every: { userId: input.userId },
        some: { userId: input.userId, role: "owner" },
      },
      workspace: { is: { projects: { none: {} } } },
    },
    select: { id: true },
  });
  // Loaded here: Better Auth's module graph stays out of the CMO service's.
  const { createOrganizationWorkspace } = await import(
    "@/helpers/organization-workspace"
  );
  const workspace = leftover
    ? await getUserWorkspace(input.userId, { organizationId: leftover.id })
    : await createOrganizationWorkspace(input.userId, {
        name: businessName,
        websiteUrl: input.websiteUrl,
      });
  if (
    !(await canFundFirstTurn({
      userId: input.userId,
      organizationId: workspace.organizationId ?? null,
    }))
  ) {
    throw new CmoConflictError(CMO_OUT_OF_CREDITS);
  }

  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      name: cmoProjectName(businessName),
      websiteUrl: input.websiteUrl,
    },
    select: { id: true },
  });

  let created: CmoHire;
  let sharedRoomId: string | null = null;
  try {
    const { createSharedSokoBot } = await import(
      "@/services/soko-bot-shared-create.service"
    );
    const bot = await createSharedSokoBot({
      callerUserId: input.userId,
      workspaceId: workspace.id,
      projectId: project.id,
      name: CUSO_NAME,
      versionId: CMO_SOKO_BOT_VERSION_ID,
    });
    sharedRoomId = bot.sharedRoomId;
    created = await prisma.cmoHire.create({
      data: {
        workspaceId: workspace.id,
        sokoBotId: bot.id,
        projectId: project.id,
        businessName,
        websiteUrl: input.websiteUrl,
        // The start form no longer asks for a goal; Cuso works from the
        // business's main offer.
        goals: "",
      },
    });
  } catch (error) {
    // No stray Project, Cuso or room: deleting the Project cascades to his
    // bot, which only lets go of its shared room.
    if (sharedRoomId)
      await prisma.chatRoom
        .delete({ where: { id: sharedRoomId } })
        .catch(() => undefined);
    await prisma.project
      .delete({ where: { id: project.id } })
      .catch((cleanupError) => {
        console.warn("CMO hire cleanup failed", {
          projectId: project.id,
          error:
            cleanupError instanceof Error ? cleanupError.message : "unknown",
        });
      });
    throw error;
  }

  // The brand's look (logo, colours, fonts, DESIGN.md) is read alongside
  // Cuso's research; it never holds up onboarding.
  waitUntil(
    learnCmoBrandVisual(created).catch((error) => {
      console.warn("CMO brand visual failed", {
        cmoHireId: created.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }),
  );

  // A turn that cannot start (no credits yet) leaves the hire ready:
  // the learning card offers Try again and says why when it fails again.
  await startCmoTurn(created, input.userId, {
    clientTurnId: `${ONBOARDING_TURN_PREFIX}${created.id}`,
    message: onboardingMessage({
      businessName,
      websiteUrl: input.websiteUrl,
      goals: created.goals,
    }),
    route: CMO_ONBOARDING_ROUTE,
  }).catch((error) => {
    console.warn("CMO onboarding turn did not start", {
      cmoHireId: created.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  });

  return created;
}

const GOAL_PRESETS = [
  "more sales",
  "more leads",
  "brand awareness",
  "launch something",
];

/**
 * The words the owner typed, if any: a preset goal is the app's English, so
 * only typed words say which language the owner reads.
 */
export function ownWords(goals: string): string | null {
  const typed = goals.replace(/^launch something:\s*/i, "").trim();
  return typed && !GOAL_PRESETS.includes(typed.toLowerCase()) ? typed : null;
}

/** Reads once what the site runs on, so Shopify is offered only to shops. */
export async function learnCmoSitePlatform(
  hire: Pick<CmoHire, "id" | "websiteUrl">,
): Promise<void> {
  const { detectSitePlatform } = await import("@/lib/site-platform");
  const platform = await detectSitePlatform(hire.websiteUrl).catch(() => null);
  if (!platform) return;
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { sitePlatform: platform },
  });
}

/** A measurement source and whether it is connected to Cuso. */
export interface CmoMeasurementStatus {
  provider: CmoMeasurementSource;
  name: string;
  measures: string;
  status: "connected" | "pending" | "none";
}

/**
 * Google Analytics, Search Console and, for a Shopify shop, Shopify, as
 * connected to Cuso's bot.
 */
export async function listCmoMeasurement(
  sokoBotId: string,
  sitePlatform: string | null,
): Promise<CmoMeasurementStatus[]> {
  const rows = await prisma.sokoBotIntegration.findMany({
    where: {
      sokoBotId,
      provider: { in: CMO_MEASUREMENT_SOURCES.map((source) => source.id) },
    },
    select: { provider: true, status: true },
  });
  const sources = CMO_MEASUREMENT_SOURCES.filter(
    (source) => source.id !== "shopify" || sitePlatform === "shopify",
  );
  return sources.map((source) => {
    const row = rows.find((candidate) => candidate.provider === source.id);
    return {
      provider: source.id,
      name: source.name,
      measures: source.measures,
      status: !row ? "none" : row.status === "ACTIVE" ? "connected" : "pending",
    };
  });
}

/**
 * Starts connecting a measurement source to Cuso's own bot (not the owner's
 * personal assistant): the owner authorizes it and comes back to returnUrl.
 */
export async function connectCmoMeasurement(input: {
  userId: string;
  provider: string;
  returnUrl: string;
}): Promise<{ redirectUrl: string }> {
  if (!isCmoMeasurementSource(input.provider)) {
    throw new CmoNotFoundError("CMO does not measure with that source");
  }
  if (!isFirstPartyAppUrl(input.returnUrl)) {
    throw new CmoConflictError("The return address must be CMO's own page");
  }
  const hire = await getCmoHireForUser(input.userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  if (input.provider === "shopify" && hire.sitePlatform !== "shopify") {
    throw new CmoConflictError("Shopify measures Shopify shops only");
  }
  const { connectSokoBotIntegration } = await import(
    "@/services/soko-bot-integration-connection.service"
  );
  return connectSokoBotIntegration({
    userId: input.userId,
    workspaceId: hire.workspaceId,
    provider: input.provider,
    returnUrl: input.returnUrl,
    selector: { kind: "id", sokoBotId: hire.sokoBotId },
  });
}

/** Finishes a measurement connection once the owner is back from authorizing. */
export async function finalizeCmoMeasurement(input: {
  userId: string;
  provider: string;
}): Promise<void> {
  if (!isCmoMeasurementSource(input.provider)) {
    throw new CmoNotFoundError("CMO does not measure with that source");
  }
  const hire = await getCmoHireForUser(input.userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  const { finalizeSokoBotIntegration } = await import(
    "@/services/soko-bot-integration-connection.service"
  );
  await finalizeSokoBotIntegration({
    userId: input.userId,
    workspaceId: hire.workspaceId,
    provider: input.provider,
    selector: { kind: "id", sokoBotId: hire.sokoBotId },
  });
}

/**
 * The owner's monthly ad budget: stored on the plan as theirs, then Cuso
 * plans the ads (and what they should bring) around exactly that amount.
 * Zero turns paid ads off.
 */
export async function setCmoAdBudget(input: {
  userId: string;
  monthly: number;
  currency: string;
}): Promise<{ turnId: string }> {
  const hire = await getCmoHireForUser(input.userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  const strategy = parseCmoStrategy(hire.strategy);
  if (!strategy) {
    throw new CmoConflictError("Cuso has not written the strategy yet");
  }
  const currency = input.currency.toUpperCase();
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: {
      strategy: {
        ...strategy,
        ads: {
          expect: "Cuso is updating what this brings.",
          without: "The plan runs on posts, search and email alone.",
          ...strategy.ads,
          monthly: input.monthly,
          currency,
          setByOwner: true,
        },
      },
    },
  });
  return requestCmoStrategy({
    userId: input.userId,
    note:
      input.monthly > 0
        ? `My ad budget is ${currency} ${input.monthly} a month. Plan the ads around exactly that amount and say what it should bring.`
        : "I don't want to spend on ads this month. Leave paid ads out and make the plan work without them.",
  });
}

/** Asks Cuso for a new one-month strategy; the owner approves it again. */
export async function requestCmoStrategy(input: {
  userId: string;
  note?: string;
}): Promise<{ turnId: string }> {
  const hire = await getCmoHireForUser(input.userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  const brain = parseCmoBrandBrain(hire.brandBrain);
  if (!brain) {
    throw new CmoConflictError("Cuso is still building the Brand Brain");
  }
  // Named up front: a goal such as "More leads" once pulled whole plans onto
  // a side product or feature with the same word in it.
  const main = brain.offers?.[0];
  const sells = `${brain.reveal?.positioning ?? brain.summary}${main ? ` Main offer: ${main.name} (${main.price}).` : ""}`;
  const started = await startCmoTurn(hire, input.userId, {
    clientTurnId: `${STRATEGY_TURN_PREFIX}${hire.id}:${Date.now()}`,
    message: (input.note
      ? [
          `Change ${hire.businessName}'s marketing strategy. The owner asked: ${input.note}`,
          "",
          "Start from the strategy in your packet and change only what the request needs. Every entry you do not change stays exactly as it is: same id, date, time and title. To move a piece, change the date on the same id; never add a copy. List each difference in changes, in plain words.",
          "Save with save_strategy: part plan for changes to the strategy (send the whole plan with your changes), part calendar for changes to the calendar (send the whole calendar). Each part leaves the other as saved.",
        ]
      : [
          `Write ${hire.businessName}'s marketing strategy for the next four weeks, starting ${tomorrow()}.`,
          ...(hire.goals
            ? [
                `What ${hire.businessName} sells, from the Brand Brain: ${sells} The plan sells this main offer to its main buyers, unless the owner's goal below names a product, launch or offer: then that is what the plan sells. Otherwise a single product or feature may carry one campaign, never the whole plan.`,
                `Their goal, in their words: ${hire.goals}. When it names a product or launch, the plan is built around it. Otherwise it is the result they want from selling the main offer; never read a word in it as a topic, product or feature to promote.`,
              ]
            : [
                `What ${hire.businessName} sells, from the Brand Brain: ${sells} The plan sells this main offer to its main buyers. A single product or feature may carry one campaign, never the whole plan.`,
                "The owner named no goal: set the one result the business most needs from selling the main offer, from the Brand Brain, and lead the plan's goals with it.",
              ]),
          ...ownerAnswers(brain),
          "Before you save, read your summary, focus, offer and pillars against the main offer above: if they drift to a narrower product or feature the owner did not name, or away from the one the owner did name, rewrite them.",
          ...(ownWords(hire.goals)
            ? [
                `The owner wrote that goal in their own words: write the plan itself (every field, calendar titles and briefs) in the language of "${ownWords(hire.goals)}". contentLanguage stays the language the audience reads.`,
              ]
            : []),
          "",
          "Follow your strategy skill exactly. Use the Brand Brain and the channels in your packet.",
          "This is the plan, not the posts. Save it in two short calls of save_strategy: first part plan (idea, alternatives, ladder, summary, why, goals, objective, barrier, mix, pillars, focus, offer, channels, pace, ads, funnel with plays and measure, beforeAfter, improvements, proposals, campaigns, weeks, measurement, questions); then part calendar, the day-by-day calendar (date, time, channel, format, approach, pillar, title, brief, why and campaignId) whose approach shares match the mix. Each part leaves the other as saved. Write no drafts, hooks or previews: after the owner approves and pays, you make the whole month at once.",
        ]
    )
      .concat([
        "Do not create Social posts or images yet; that starts after the owner approves.",
        "Then tell the owner in one or two sentences what the plan does first. The strategy card is your report: do not call report_update, and never mention tools, Social posts or what you did not do.",
      ])
      .join("\n"),
    route: CMO_STRATEGY_ROUTE,
  });
  // Only now: a turn that cannot start leaves the approved plan running.
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { strategyApprovedAt: null },
  });
  return started;
}

/**
 * The member Cuso's own runs act as (his rhythms, the month's production, the
 * brand capture): who hired him while they are still a member of the
 * business, else its longest-standing owner or admin, so a hirer who left
 * never stalls the business's month (ADR 0061). Null only for an organization
 * with neither.
 */
export async function cmoRunnerUserId(
  hire: Pick<CmoHire, "workspaceId" | "sokoBotId">,
): Promise<string | null> {
  const [{ organizationId }, bot] = await Promise.all([
    cmoPayer(hire),
    prisma.sokoBot.findUnique({
      where: { id: hire.sokoBotId },
      select: { createdByUserId: true },
    }),
  ]);
  const hirer = bot?.createdByUserId ?? null;
  const members = await prisma.member.findMany({
    where: {
      organizationId,
      OR: [
        ...(hirer ? [{ userId: hirer }] : []),
        { role: { in: [MemberRole.OWNER, MemberRole.ADMIN] } },
      ],
    },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  return (
    members.find((member) => member.userId === hirer)?.userId ??
    members[0]?.userId ??
    null
  );
}

/** A write's target: the hire a member works with, or Cuso's own. */
async function cmoHireWhere(
  where: { userId: string } | { sokoBotId: string },
): Promise<Prisma.CmoHireWhereUniqueInput> {
  if ("sokoBotId" in where) return where;
  const hire = await getCmoHireForUser(where.userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  return { id: hire.id };
}

/**
 * Merges a save into the stored Brand Brain: sent sections replace theirs,
 * sent essentials replace the essentials. Until the essentials exist the
 * record holds only sections and the owner does not see it yet.
 */
export async function saveCmoBrandBrain(
  where: { userId: string } | { sokoBotId: string },
  input: CmoSaveBrandBrainInput,
  db?: Prisma.TransactionClient,
): Promise<CmoHire> {
  const save = cmoSaveBrandBrainInputSchema.parse(input);
  const target = await cmoHireWhere(where);
  const write = async (tx: Prisma.TransactionClient) => {
    const hire = await tx.cmoHire.findUnique({
      where: target,
      select: { id: true },
    });
    if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
    // Section saves run in parallel: lock the row so none overwrites another.
    await tx.$executeRaw`SELECT 1 FROM cmo_hire WHERE id = ${hire.id}::uuid FOR UPDATE`;
    const current = await tx.cmoHire.findUnique({
      where: { id: hire.id },
      select: { brandBrain: true },
    });
    const stored = storedBrandBrain(current?.brandBrain);
    const incoming = { ...save.brandBrain?.profile, ...save.sections };
    // Cuso's packet carries no findings; a section he rewrites keeps them.
    const kept = Object.fromEntries(
      Object.entries(incoming).map(([key, section]) => {
        const before = stored.profile[key as CmoBrandSectionKey];
        return [
          key,
          section && section.findings.length === 0 && before
            ? { ...section, findings: before.findings }
            : section,
        ];
      }),
    );
    const profile = cmoBrandProfileSchema.parse({
      ...stored.profile,
      ...kept,
    });
    const before = parseCmoBrandBrain(stored);
    const essentials = save.brandBrain
      ? {
          ...save.brandBrain,
          questions: keepAnswers(
            save.brandBrain.questions,
            before?.questions ?? [],
          ),
        }
      : before;
    const next = essentials ? { ...essentials, profile } : { profile };
    return tx.cmoHire.update({
      where: { id: hire.id },
      data: {
        brandBrain: next,
        ...(essentials ? { brandBrainUpdatedAt: new Date() } : {}),
      },
    });
  };
  return db ? write(db) : prisma.$transaction(write);
}

/**
 * Questions saved again keep the owner's answers: Cuso asks, only the owner
 * answers, so an answer Cuso leaves out is the stored one.
 */
function keepAnswers(
  incoming: CmoBrandQuestion[],
  stored: CmoBrandQuestion[],
): CmoBrandQuestion[] {
  return incoming.map((question) => {
    const answered = stored.find((candidate) => candidate.id === question.id);
    return answered?.answer && !question.answer
      ? { ...question, answer: answered.answer, note: answered.note }
      : question;
  });
}

/** What an answer adds to its section: a yes confirms, a no with a note corrects. */
function answerFinding(question: CmoBrandQuestion): CmoBrandFinding | null {
  const point =
    question.answer === "yes"
      ? question.statement
      : question.answer === "no"
        ? question.note
        : undefined;
  return point
    ? {
        point,
        evidence: "fact",
        confidence: "high",
        asOf: new Date().toISOString().slice(0, 7),
      }
    : null;
}

/** The owner's answers, for the strategy request; none when nothing was answered. */
function ownerAnswers(brain: CmoBrandBrain): string[] {
  const answered = brain.questions.filter(
    (question) => question.answer && question.answer !== "unsure",
  );
  if (answered.length === 0) return [];
  return [
    "The owner answered your Brand Brain questions. A yes confirms the statement; a no overrides your reading, and its note says what is true instead:",
    ...answered.map(
      (question) =>
        `- ${question.question} ${question.answer}${question.note ? `: ${question.note}` : ""}`,
    ),
  ];
}

/** The owner approved the Brand Brain; his questions come next. */
export async function approveCmoBrandBrain(userId: string): Promise<void> {
  const hire = await getCmoHireForUser(userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  if (!parseCmoBrandBrain(hire.brandBrain)) {
    throw new CmoConflictError("Cuso is still building the Brand Brain");
  }
  if (hire.brandBrainApprovedAt) return;
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { brandBrainApprovedAt: new Date() },
  });
}

/**
 * The owner's answer to one of Cuso's questions. It is stored on the
 * question and lands in its section as a confirmed finding (replacing what
 * an earlier answer to the same question put there), so every later plan and
 * post reads it.
 */
export async function answerCmoBrandQuestion(
  userId: string,
  input: { questionId: string; answer: CmoBrandAnswer; note?: string },
): Promise<void> {
  const target = await cmoHireWhere({ userId });
  await prisma.$transaction(async (tx) => {
    const hire = await tx.cmoHire.findUnique({
      where: target,
      select: { id: true },
    });
    if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
    await tx.$executeRaw`SELECT 1 FROM cmo_hire WHERE id = ${hire.id}::uuid FOR UPDATE`;
    const current = await tx.cmoHire.findUnique({
      where: { id: hire.id },
      select: { brandBrain: true },
    });
    const brain = parseCmoBrandBrain(current?.brandBrain);
    const question = brain?.questions.find(
      (candidate) => candidate.id === input.questionId,
    );
    if (!brain || !question) {
      throw new CmoNotFoundError("That question is not in the Brand Brain");
    }
    const answered: CmoBrandQuestion = {
      ...question,
      answer: input.answer,
      note: input.answer === "no" ? input.note?.trim() || undefined : undefined,
    };
    const earlier = [question.statement, question.note].filter(Boolean);
    const section = brain.profile[question.section];
    const finding = answerFinding(answered);
    const findings = [
      ...(finding ? [finding] : []),
      ...(section?.findings ?? []).filter(
        (candidate) => !earlier.includes(candidate.point),
      ),
    ].slice(0, 6);
    const profile = {
      ...brain.profile,
      [question.section]: section
        ? { ...section, findings }
        : finding
          ? { answer: finding.point, findings, openQuestions: [] }
          : undefined,
    };
    await tx.cmoHire.update({
      where: { id: hire.id },
      data: {
        brandBrain: {
          ...brain,
          profile,
          questions: brain.questions.map((candidate) =>
            candidate.id === question.id ? answered : candidate,
          ),
        },
      },
    });
  });
}

/** The profile sections a stored Brand Brain holds, in profile order. */
export function cmoBrandSectionsSaved(value: unknown): CmoBrandSectionKey[] {
  const { profile } = storedBrandBrain(value);
  return CMO_BRAND_SECTION_KEYS.filter((key) => profile[key]);
}

function storedBrandBrain(value: unknown): { profile: CmoBrandProfile } {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const profile = cmoBrandProfileSchema.safeParse(record.profile ?? {});
  return { ...record, profile: profile.success ? profile.data : {} };
}

const STRATEGY_HISTORY_LIMIT = 8;
/** Matches the calendar slice in the turn packet. A full plan with drafts does not fit. */
const CMO_VISIBLE_CALENDAR_DAYS = 31;
const CMO_CALENDAR_LIMIT = 120;

function calendarBounds(now: Date, days: number): { from: string; to: string } {
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

/**
 * A bot turn only sees the next 31 days. Put back entries outside that window
 * so save_strategy cannot delete them. An incoming entry with the same id, or
 * the same day and channel, still wins. Owner saves pass no turn id and replace
 * the calendar outright.
 */
function withHiddenCalendar(
  previous: CmoStrategy["calendar"],
  incoming: CmoStrategy["calendar"],
  now: Date,
): CmoStrategy["calendar"] {
  const { from, to } = calendarBounds(now, CMO_VISIBLE_CALENDAR_DAYS);
  const seen = new Set(incoming.map((entry) => entry.id));
  const covered = new Set(
    incoming.map((entry) => `${entry.date}\0${entry.channel}`),
  );
  const hidden = previous.filter(
    (entry) =>
      !seen.has(entry.id) &&
      (entry.date < from || entry.date > to) &&
      !covered.has(`${entry.date}\0${entry.channel}`),
  );
  const room = CMO_CALENDAR_LIMIT - incoming.length;
  if (room <= 0 || hidden.length === 0) return incoming;
  const kept = hidden
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-room);
  return [...incoming, ...kept].sort((left, right) =>
    left.date === right.date
      ? left.id.localeCompare(right.id)
      : left.date.localeCompare(right.date),
  );
}

function sameTitle(left: string, right: string): boolean {
  const squash = (text: string) => text.toLowerCase().replace(/\W+/g, "");
  return squash(left) === squash(right);
}

/**
 * Guards a bot's save against the two ways a revision loses work: an entry
 * kept under the same id and title without its draft gets the draft back,
 * and an entry left in its old slot while a copy moved to a new day is
 * dropped, so a moved piece shows once.
 */
export function keepCalendarWork(
  previous: CmoStrategy["calendar"],
  incoming: CmoStrategy["calendar"],
): CmoStrategy["calendar"] {
  const before = new Map(previous.map((entry) => [entry.id, entry]));
  // Entries past the first week reach Cuso without their words (the
  // packet's detailsStored); sent back under the same title, they keep them.
  const withDrafts = incoming.map((entry) => {
    const old = before.get(entry.id);
    if (!old || !sameTitle(old.title, entry.title)) return entry;
    return {
      ...entry,
      draft: entry.draft ?? old.draft,
      brief: entry.brief ?? old.brief,
      why: entry.why ?? old.why,
      hook: entry.hook ?? old.hook,
    };
  });
  return withDrafts.filter((entry) => {
    const old = before.get(entry.id);
    const untouched = old?.date === entry.date;
    if (!untouched) return true;
    const moved = withDrafts.some(
      (other) =>
        other !== entry &&
        other.channel === entry.channel &&
        other.date !== entry.date &&
        sameTitle(other.title, entry.title) &&
        // A series ("Tip of the week") repeats the title, not the words.
        ((!!other.hook && other.hook === entry.hook) ||
          (!!other.draft && other.draft === entry.draft)) &&
        before.get(other.id)?.date !== other.date,
    );
    return !moved;
  });
}

const DASH = /\s*[—–]\s*/g;

/**
 * Cuso's copy goes out under the brand's name; em and en dashes read as AI
 * writing. Number ranges ("3–5") keep a plain hyphen.
 */
export function withoutDashes<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
      .replace(DASH, ", ") as T;
  }
  if (Array.isArray(value)) return value.map(withoutDashes) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withoutDashes(item)]),
    ) as T;
  }
  return value;
}

const strategyHistorySchema = z.array(
  z.object({
    savedAt: z.string(),
    turnId: z.string().nullable(),
    strategy: z.json(),
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
  strategy: CmoStrategySave,
  options: {
    turnId?: string;
    now?: Date;
    /** The calendar sent is only the pieces Cuso changed: merge them by id. */
    pieces?: boolean;
  } = {},
  db: Prisma.TransactionClient = prisma,
): Promise<CmoHire> {
  const current = await db.cmoHire.findUnique({
    where: await cmoHireWhere(where),
  });
  if (!current) throw new CmoNotFoundError("Cuso is not hired yet");
  // What a save leaves out stays as stored; the merged plan must be whole.
  const before = parseCmoStrategy(current.strategy);
  const whole = cmoStrategySchema.parse({
    ...before,
    ...Object.fromEntries(
      Object.entries(strategy).filter(([, value]) => value !== undefined),
    ),
    calendar: options.pieces
      ? mergeCalendarPieces(before?.calendar ?? [], strategy.calendar ?? [])
      : (strategy.calendar ?? before?.calendar ?? []),
  });
  // A channel the plan now runs is no longer a proposal.
  const running = new Set(whole.channels.map((channel) => channel.channel));
  // The ad budget the owner set is theirs: Cuso's saves plan around it.
  const ownerAds =
    options.turnId && before?.ads?.setByOwner ? before.ads : undefined;
  const parsed = {
    ...whole,
    questions: keepPlanAnswers(before?.questions ?? [], whole.questions),
    proposals: whole.proposals.filter(
      (proposal) => !running.has(proposal.channel),
    ),
    ...(ownerAds
      ? {
          ads: {
            ...(whole.ads ?? ownerAds),
            monthly: ownerAds.monthly,
            currency: ownerAds.currency,
            setByOwner: true,
          },
        }
      : {}),
  };
  const previous = options.turnId ? before : null;
  const merged = previous
    ? {
        ...parsed,
        calendar: withHiddenCalendar(
          previous.calendar,
          keepCalendarWork(previous.calendar, parsed.calendar),
          options.now ?? new Date(),
        ),
        // An empty previews list keeps the stored samples.
        previews:
          parsed.previews.length > 0 ? parsed.previews : previous.previews,
      }
    : parsed;
  const stored = options.turnId
    ? withoutDashes(withLineBreaks(merged))
    : merged;
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
  return db.cmoHire.update({
    where: { id: current.id },
    data: {
      strategy: stored,
      strategyUpdatedAt: new Date(),
      strategyHistory: history,
    },
  });
}

/**
 * A model sometimes writes line breaks as the two characters "\\n" inside a
 * draft; they would show up literally in a post.
 */
export function withLineBreaks<T extends { calendar: CmoStrategy["calendar"] }>(
  strategy: T,
): T {
  return {
    ...strategy,
    calendar: strategy.calendar.map((entry) =>
      entry.draft?.includes("\\n")
        ? { ...entry, draft: entry.draft.replace(/\\n/g, "\n") }
        : entry,
    ),
  };
}

/**
 * A pieces save: each sent entry updates the stored one with its id, a new
 * id is added, and every entry not sent stays as it is.
 */
export function mergeCalendarPieces(
  stored: CmoStrategy["calendar"],
  sent: CmoStrategySave["calendar"],
): CmoStrategy["calendar"] {
  const byId = new Map((sent ?? []).map((entry) => [entry.id, entry]));
  const merged = stored.map((entry) => {
    const update = byId.get(entry.id);
    byId.delete(entry.id);
    return update ? { ...entry, ...update } : entry;
  });
  return [...merged, ...byId.values()] as CmoStrategy["calendar"];
}

/** The owner's answers survive Cuso saving the plan's questions again. */
export function keepPlanAnswers(
  before: CmoPlanQuestion[],
  sent: CmoPlanQuestion[],
): CmoPlanQuestion[] {
  return sent.map((question) => {
    const earlier = before.find((candidate) => candidate.id === question.id);
    return earlier?.answer && !question.answer
      ? { ...question, answer: earlier.answer, note: earlier.note }
      : question;
  });
}

/** The owner answers one of the plan's yes/no questions. */
export async function answerCmoPlanQuestion(
  userId: string,
  input: { questionId: string; answer: CmoBrandAnswer; note?: string },
): Promise<void> {
  const target = await cmoHireWhere({ userId });
  await prisma.$transaction(async (tx) => {
    const hire = await tx.cmoHire.findUnique({
      where: target,
      select: { id: true },
    });
    if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
    await tx.$executeRaw`SELECT 1 FROM cmo_hire WHERE id = ${hire.id}::uuid FOR UPDATE`;
    const current = await tx.cmoHire.findUnique({
      where: { id: hire.id },
      select: { strategy: true },
    });
    const strategy = parseCmoStrategy(current?.strategy);
    if (!strategy?.questions.some((q) => q.id === input.questionId)) {
      throw new CmoNotFoundError("That question is not in the plan");
    }
    const note =
      input.answer === "no" ? input.note?.trim() || undefined : undefined;
    await tx.cmoHire.update({
      where: { id: hire.id },
      data: {
        strategy: {
          ...strategy,
          questions: strategy.questions.map((question) =>
            question.id === input.questionId
              ? { ...question, answer: input.answer, note }
              : question,
          ),
        },
      },
    });
  });
}

/**
 * What the owner's answers change: each no, with what is true instead. A
 * yes confirms the plan as written and "not sure" leaves Cuso's guess.
 */
export function cmoPlanAnswerNote(questions: CmoPlanQuestion[]): string | null {
  const changes = questions
    .filter((question) => question.answer === "no")
    .map(
      (question) =>
        `- "${question.question}" No.${question.note ? ` What is true: ${question.note}` : ""} (You had assumed: ${question.statement})`,
    );
  return changes.length > 0
    ? [
        "The owner answered your questions about the plan. Change the plan where an answer says your assumption was wrong; keep everything else.",
        ...changes,
      ].join("\n")
    : null;
}

/** Cuso revises the plan to fit the owner's answers. */
export async function applyCmoPlanAnswers(
  userId: string,
): Promise<{ turnId: string }> {
  const hire = await getCmoHireForUser(userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  const note = cmoPlanAnswerNote(
    parseCmoStrategy(hire.strategy)?.questions ?? [],
  );
  if (!note) throw new CmoConflictError("Your answers confirm the plan");
  return requestCmoStrategy({ userId, note });
}

/** The owner's one approval: from now on Cuso executes the strategy. */
export async function approveCmoStrategy(userId: string): Promise<CmoHire> {
  const hire = await getCmoHireForUser(userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  await requireCmoCommitter(userId, hire);
  if (!parseCmoStrategy(hire.strategy)) {
    throw new CmoConflictError("There is no strategy to approve yet");
  }
  // The approval would carry over to the plan Cuso is writing, unreviewed.
  const writing = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: hire.sokoBotId,
      clientTurnId: { startsWith: STRATEGY_TURN_PREFIX },
    },
    orderBy: { createdAt: "desc" },
    select: TURN_ROW_SELECT,
  });
  if (writing && (await settledTurnStatus(writing, new Date())) === "running") {
    throw new CmoConflictError(
      "Cuso is still writing the new strategy; approve it when it is ready",
    );
  }
  const approved = await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { strategyApprovedAt: hire.strategyApprovedAt ?? new Date() },
  });
  // Already paying (a re-approved plan): the month is made right away.
  await startCmoProduction(hire.id);
  return approved;
}

const cmoUpdateRecordSchema = cmoReportUpdateInputSchema.extend({
  id: z.string(),
  at: z.string(),
  /** Weekly and monthly: the strategy before this turn's changes, for revert. */
  previousStrategy: z.json().optional(),
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
export async function reportCmoUpdate(
  input: {
    sokoBotId: string;
    turnId: string;
    update: CmoReportUpdateInput;
  },
  db: Prisma.TransactionClient = prisma,
): Promise<CmoUpdateRecord> {
  const hire = await db.cmoHire.findUnique({
    where: { sokoBotId: input.sokoBotId },
  });
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  const update = cmoReportUpdateInputSchema.parse(input.update);
  const savedThisTurn = parseHistory(hire.strategyHistory).filter(
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
  await db.cmoHire.update({
    where: { id: hire.id },
    data: {
      updates: [record, ...parseCmoUpdates(hire.updates)].slice(
        0,
        UPDATES_LIMIT,
      ),
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
  const hire = await getCmoHireForUser(input.userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  const strategy = parseCmoStrategy(hire.strategy);
  const entry = strategy?.calendar.find((item) => item.id === input.entryId);
  if (!strategy || !entry) {
    throw new CmoNotFoundError("No such calendar entry");
  }
  if (entry.socialPostId) {
    const post = await prisma.socialPost.findFirst({
      where: { id: entry.socialPostId, projectId: hire.projectId },
      select: { status: true, revision: true },
    });
    // A post already going out refuses (409) and the entry stays as it is.
    if (post && post.status !== "CANCELED") {
      const { cancelSocialPost } = await import(
        "@/services/social-posts.service"
      );
      await cancelSocialPost({
        projectId: hire.projectId,
        workspaceId: hire.workspaceId,
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

/**
 * Puts back the strategy a weekly review or monthly strategy replaced.
 * Entries already handed to Social stay as they are now, so Pause can still
 * cancel their posts.
 */
export async function revertCmoUpdate(input: {
  userId: string;
  updateId: string;
}): Promise<CmoHire> {
  const hire = await getCmoHireForUser(input.userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  const updates = parseCmoUpdates(hire.updates);
  const target = updates.find((update) => update.id === input.updateId);
  const previous = parseCmoStrategy(target?.previousStrategy);
  if (!target || !previous) {
    throw new CmoNotFoundError("Nothing to revert for this update");
  }
  if (target.revertedAt) return hire;
  // Entries handed to Social and entries the owner paused stay as they are.
  const kept = new Map(
    (parseCmoStrategy(hire.strategy)?.calendar ?? [])
      .filter((entry) => entry.socialPostId || entry.status === "skipped")
      .map((entry) => [entry.id, entry]),
  );
  const calendar = [
    ...previous.calendar.map((entry) => kept.get(entry.id) ?? entry),
    ...[...kept.values()].filter(
      (entry) => !previous.calendar.some((old) => old.id === entry.id),
    ),
  ].sort((left, right) => left.date.localeCompare(right.date));
  await saveCmoStrategy({ userId: input.userId }, { ...previous, calendar });
  return prisma.cmoHire.update({
    where: { id: hire.id },
    data: {
      updates: updates.map((update) =>
        update.id === target.id
          ? { ...update, revertedAt: new Date().toISOString() }
          : update,
      ),
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
  const hire = await getCmoHireForBot(input.sokoBotId);
  if (!hire) return null;
  const verdict = cmoMayExecute({
    approved: hire.strategyApprovedAt !== null,
    subscribed: await isCmoSubscribed(hire),
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
  const { from, to } = calendarBounds(now, days);
  return strategy.calendar.filter(
    (entry) => entry.date >= from && entry.date <= to,
  );
}

/**
 * What Cuso sees about the business on every turn: the Brand Brain, the
 * strategy, and the next 31 days of the calendar. Entries outside that
 * window stay in the saved plan. Null for any bot that is not a CMO bot.
 */
export async function loadCmoMarketingContext(
  sokoBotId: string,
  now: Date = new Date(),
): Promise<Record<string, unknown> | null> {
  const hire = await getCmoHireForBot(sokoBotId);
  if (!hire) return null;
  const strategy = parseCmoStrategy(hire.strategy);
  const context: MarketingContext = {
    business: {
      name: hire.businessName,
      websiteUrl: hire.websiteUrl,
      goals: hire.goals,
      marketingProjectId: hire.projectId,
    },
    strategyApproved: hire.strategyApprovedAt !== null,
    subscriptionActive: await isCmoSubscribed(hire),
    connectedChannels: (await listCmoChannels(hire.projectId)).map(
      (channel) => ({
        provider: channel.provider,
        handle: channel.externalHandle,
        status: channel.status,
        socialConnectionId: channel.id,
      }),
    ),
    brandBrain: compactBrandBrain(parseCmoBrandBrain(hire.brandBrain)),
    /** The brand's logo, colours and fonts: use them in images and layouts. */
    brandVisual: parseCmoBrandVisual(hire.brandVisual),
    /** The brand's own photos from its site: references for generate_image. */
    brandPictures: cmoBrandPictures(hire.brandMedia),
    strategy: strategy
      ? {
          ...strategy,
          // Next 31 days. saveCmoStrategy puts entries outside this window back.
          // Drafts past the first week stay stored: keepCalendarWork restores
          // them when an entry comes back under its id and title without one.
          calendar: calendarWindow(
            strategy,
            now,
            CMO_VISIBLE_CALENDAR_DAYS,
          ).map((entry) =>
            entry.date > draftHorizon(now)
              ? {
                  ...entry,
                  draft: undefined,
                  brief: undefined,
                  why: undefined,
                  hook: undefined,
                  detailsStored: true,
                }
              : entry,
          ),
          calendarTotal: strategy.calendar.length,
        }
      : null,
    recentUpdates: parseCmoUpdates(hire.updates)
      .slice(0, 3)
      .map(({ previousStrategy: _previous, ...update }) => update),
  };
  return fitCmoMarketingContext(context, now);
}

/** The pictures research saved from the brand's pages, as Files to reference. */
export function cmoBrandPictures(
  brandMedia: unknown,
): { fileId: string; alt: string; size: string }[] {
  return (parseCmoBrandMedia(brandMedia)?.pictures ?? []).flatMap((picture) =>
    picture.fileId
      ? [
          {
            fileId: picture.fileId,
            alt: picture.alt.slice(0, 80),
            size: `${picture.width}x${picture.height}`,
          },
        ]
      : [],
  );
}

/**
 * Bytes Cuso's marketing context may take of the 48 KB packet; the rest is
 * memory, the conversation and the trigger. A big Brand Brain with a made
 * month once pushed the packet past its hard limit and every turn failed.
 */
export const CMO_CONTEXT_BUDGET_BYTES = 32 * 1_024;

type MarketingContext = Record<string, unknown> & {
  brandBrain?: Record<string, unknown> | null;
  strategy?: (Record<string, unknown> & { calendar?: unknown[] }) | null;
};

/**
 * Sheds detail, least needed first, until the context fits its budget.
 * Everything shed stays stored: saves merge into what is there, and a piece
 * sent back under its id and title keeps its words.
 */
export function fitCmoMarketingContext(
  context: MarketingContext,
  now: Date,
  budget: number = CMO_CONTEXT_BUDGET_BYTES,
): MarketingContext {
  const soon = new Date(now.getTime() + 3 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const later = (entry: Record<string, unknown>) =>
    typeof entry.date === "string" && entry.date > soon;
  const calendar = (
    current: MarketingContext,
    shed: (entry: Record<string, unknown>) => Record<string, unknown>,
  ): MarketingContext =>
    current.strategy
      ? {
          ...current,
          strategy: {
            ...current.strategy,
            calendar: (current.strategy.calendar ?? []).map((entry) =>
              later(entry as Record<string, unknown>)
                ? shed(entry as Record<string, unknown>)
                : entry,
            ),
          },
        }
      : current;
  const without = (
    current: MarketingContext,
    part: "brandBrain" | "strategy",
    keys: string[],
  ): MarketingContext => {
    const value = current[part];
    if (!value) return current;
    const kept = Object.fromEntries(
      Object.entries(value).filter(([key]) => !keys.includes(key)),
    );
    const stored = [
      ...((value.storedNotShown as string[] | undefined) ?? []),
      ...keys,
    ];
    return { ...current, [part]: { ...kept, storedNotShown: stored } };
  };
  const steps: ((current: MarketingContext) => MarketingContext)[] = [
    (current) =>
      calendar(current, ({ draft: _draft, ...entry }) => ({
        ...entry,
        detailsStored: true,
      })),
    (current) => without(current, "strategy", ["previews", "weeks"]),
    (current) =>
      calendar(current, ({ brief: _b, why: _w, hook: _h, ...entry }) => ({
        ...entry,
        detailsStored: true,
      })),
    (current) =>
      current.brandBrain
        ? {
            ...current,
            brandBrain: {
              ...current.brandBrain,
              profile: Object.fromEntries(
                Object.entries(
                  (current.brandBrain.profile ?? {}) as Record<
                    string,
                    Record<string, unknown>
                  >,
                ).map(([key, section]) => [
                  key,
                  { headline: section.headline, answer: section.answer },
                ]),
              ),
            },
          }
        : current,
    (current) =>
      without(current, "strategy", [
        "alternatives",
        "beforeAfter",
        "measurement",
        "proposals",
        "changes",
      ]),
    (current) =>
      without(current, "brandBrain", ["reveal", "alternatives", "channels"]),
    (current) =>
      calendar(current, ({ pillar: _p, campaignId: _c, ...entry }) => entry),
  ];
  let fitted = context;
  for (const step of steps) {
    if (Buffer.byteLength(JSON.stringify(fitted)) <= budget) break;
    fitted = step(fitted);
  }
  return fitted;
}

/** The last day a turn sees full drafts for. */
function draftHorizon(now: Date): string {
  return new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The Brand Brain as a turn reads it: each section's headline, answer, what
 * its findings mean and its open questions. The findings themselves stay
 * stored; a full profile no longer fits Cuso's context packet.
 */
export function compactBrandBrain(
  brain: CmoBrandBrain | null,
): Record<string, unknown> | null {
  if (!brain) return null;
  const profile = Object.fromEntries(
    Object.entries(brain.profile ?? {}).flatMap(([key, section]) =>
      section
        ? [
            [
              key,
              {
                headline: section.headline,
                answer: section.answer,
                soWhat: section.findings
                  .map((finding) => finding.implication)
                  .filter(Boolean)
                  .slice(0, 2),
                openQuestions: section.openQuestions,
                findingsStored: section.findings.length,
              },
            ],
          ]
        : [],
    ),
  );
  // An answered question already lives in its section as a finding.
  const questions = brain.questions.filter((question) => !question.answer);
  return { ...brain, profile, questions };
}

/** The packet appended to a CMO rhythm's prompt. */
export async function buildCmoBeatPacket(
  sokoBotId: string,
  now: Date,
  key: CmoSystemSchedule["key"],
): Promise<{ packet: string; skip: boolean }> {
  const hire = await getCmoHireForBot(sokoBotId);
  if (!hire) return { packet: "", skip: true };
  // Nothing runs without a reason: no approved strategy, no Brand Brain,
  // or not the reminder's one slot. A skipped run costs no turn.
  const skipReason = cmoRoutineSkipReason(key, {
    brandBrain: parseCmoBrandBrain(hire.brandBrain) !== null,
    strategySavedAt: hire.strategy ? hire.strategyUpdatedAt : null,
    strategyApproved: hire.strategyApprovedAt !== null,
    now,
  });
  if (skipReason) return { packet: "", skip: true };
  const context = await loadCmoMarketingContext(sokoBotId, now);
  if (!context) return { packet: "", skip: true };
  const posts = hire
    ? await prisma.socialPost.findMany({
        where: {
          projectId: hire.projectId,
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
    // Every turn's context already carries both in full; repeating them here
    // pushed a full four-week plan past the 20,000-character message limit.
    "## Brand Brain and strategy: workspace.marketing in your context. Its calendar is the next 31 days; entries outside that window stay when you save_strategy.",
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
  hire: CmoHire;
  /** The image or video attached to each calendar piece, viewable by URL. */
  media: CmoCalendarMedia[];
  /** Cuso's Workspace's organization, when it is not a personal one. */
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
  /** This member may approve the strategy and start the paid month. */
  viewerCanApprove: boolean;
  /** CMO_MOCK_BILLING: CMO offers its own tiers without checkout. */
  mockBilling: boolean;
  mockPlan: string | null;
  mockPlanActivatedAt: Date | null;
  brandBrain: CmoBrandBrain | null;
  strategy: CmoStrategy | null;
  botStatus: string;
  updates: CmoUpdateRecord[];
  channels: Awaited<ReturnType<typeof listCmoChannels>>;
  upNext: CmoUpNextItem[];
  connectChannelUrl: string;
  /** Ad providers with an active connection on Cuso's Project. */
  adProviders: string[];
  /** Sokosumi's Ads page for Cuso's Project, where ad accounts connect. */
  connectAdsUrl: string;
  /** Google Analytics, Search Console and Shopify, as connected to Cuso. */
  measurement: CmoMeasurementStatus[];
  /** The month's production after payment: how many pieces are made. */
  production: import("@/services/cmo-production.service").CmoProductionStatus;
  /** People on the newsletter list. */
  mailingListSize: number;
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
  strategy: Pick<CmoStrategy, "calendar"> | null,
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

/** Everything the CMO app shows, in one read, for one member of the business. */
export async function getCmoOverview(
  userId: string,
  now: Date = new Date(),
): Promise<CmoOverview | null> {
  const hire = await getCmoHireForUser(userId);
  if (!hire) return null;
  const payer = await cmoPayer(hire);
  const [organization, project, bot, channels] = await Promise.all([
    payer.organizationId
      ? prisma.organization.findUnique({
          where: { id: payer.organizationId },
          select: { slug: true },
        })
      : null,
    prisma.project.findUnique({
      where: { id: hire.projectId },
      select: { name: true, logo: true },
    }),
    prisma.sokoBot.findUnique({
      where: { id: hire.sokoBotId },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        sharedRoomId: true,
        workspace: { select: { organizationId: true } },
      },
    }),
    listCmoChannels(hire.projectId),
  ]);
  const [adConnections, mailingListSize, measurement] = await Promise.all([
    prisma.projectAdConnection.findMany({
      where: { projectId: hire.projectId, status: "active" },
      select: { provider: true },
    }),
    cmoMailingListSize(hire),
    listCmoMeasurement(hire.sokoBotId, hire.sitePlatform),
  ]);
  if (hire.sitePlatform === null) waitUntil(learnCmoSitePlatform(hire));
  const postGroups = await prisma.socialPost.groupBy({
    by: ["status"],
    where: { projectId: hire.projectId },
    _count: { _all: true },
  });
  // The chat is Cuso's shared room with every member (ADR 0061).
  if (!bot?.sharedRoomId || !project) return null;
  const strategy = parseCmoStrategy(hire.strategy);
  const web = getWebAppBaseUrl().replace(/\/+$/, "");
  const [credits, viewerCanApprove] = await Promise.all([
    buildCreditsPayload({
      userId,
      organizationId: payer.organizationId,
      referenceId: payer.referenceId,
      tx: prisma,
    }),
    mayCommitCmo(userId, payer.organizationId),
  ]);
  const mockPlan = cmoMockPlan(hire);
  const cmoPlan = mockPlan ?? (await activeCmoPlan(payer.referenceId));
  const media = await cmoCalendarMedia({
    strategy,
    workspaceId: bot.workspaceId,
    organizationId: bot.workspace.organizationId,
    userId,
  });
  const { readCmoProduction } = await import(
    "@/services/cmo-production.service"
  );
  const production = await readCmoProduction(hire, {
    connected: new Set(
      channels
        .filter((channel) => channel.status === "ACTIVE")
        .map((channel) => channel.provider.toLowerCase()),
    ),
    subscribed: cmoPlan !== null,
    now,
  });
  const learning = await cmoLearningState(hire, now);
  const work = await cmoWork(hire, now);
  const schedules = await prisma.sokoBotSchedule.findMany({
    where: { sokoBotId: hire.sokoBotId, systemKey: { not: null } },
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
    hire,
    media,
    learning,
    work,
    brandVisual: parseCmoBrandVisual(hire.brandVisual),
    projectLogo: project.logo,
    routines,
    organizationSlug: organization?.slug ?? null,
    projectName: project.name,
    roomId: bot.sharedRoomId,
    subscriptionActive: cmoPlan !== null,
    viewerCanApprove,
    mockBilling: cmoMockBilling(),
    mockPlan,
    mockPlanActivatedAt: mockPlan ? hire.mockPlanActivatedAt : null,
    brandBrain: parseCmoBrandBrain(hire.brandBrain),
    strategy,
    botStatus: bot.status,
    updates: parseCmoUpdates(hire.updates),
    channels,
    upNext: cmoUpNext(
      strategy,
      now,
      channels
        .filter((channel) => channel.status === "ACTIVE")
        .map((channel) => channel.provider),
    ),
    // Connecting an account is a human OAuth step in Sokosumi's Social page.
    connectChannelUrl: `${web}/social?projectId=${hire.projectId}`,
    adProviders: [...new Set(adConnections.map((row) => row.provider))],
    connectAdsUrl: `${web}/ads?projectId=${hire.projectId}`,
    measurement,
    production: production.status,
    mailingListSize,
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

/**
 * The contact list Cuso writes the newsletter for, in the CMO workspace. The
 * CMO app fills it through the standard contact-list import.
 */
export const CMO_MAILING_LIST_NAME = "Newsletter";

/** How many people are on the newsletter list. */
async function cmoMailingListSize(
  hire: Pick<CmoHire, "workspaceId">,
): Promise<number> {
  return prisma.contactListMember.count({
    where: {
      list: {
        workspaceId: hire.workspaceId,
        nameKey: contactListNameKey(CMO_MAILING_LIST_NAME),
      },
      contact: { mergedIntoId: null },
    },
  });
}
