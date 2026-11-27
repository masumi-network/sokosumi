import {
  CMO_BRAND_SECTION_KEYS,
  CMO_BRAND_SECTIONS,
  CMO_RESEARCH_GROUPS,
  CMO_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
} from "@sokosumi/soko-bot";
import {
  buildOrganizationMetadataWithUrl,
  CORE_API_ERROR_KINDS,
  parseOrganizationMetadata,
} from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import { getEnv } from "@/config/env";
import { isOnEmailAllowlist } from "@/helpers/email-allowlist";
import { deleteFailedHireProject } from "@/helpers/soko-bot-deletion-crossing-rules";
import { getUserWorkspace } from "@/helpers/user-workspaces";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import {
  emitCoreWarning,
  recordCoreWarning,
  runAsBackgroundWork,
} from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { type PresetRoute } from "@/lib/soko-bot/classifier";
import { cmoCapabilityLabel } from "@/lib/soko-bot/cmo-step-labels";
import { safeReasoningSummary } from "@/lib/soko-bot/event-text";
import type { TurnPart } from "@/lib/soko-bot/turn-parts";
import {
  brandBrainSectionHeadlines,
  brandBrainSectionsSaved,
  type CmoSectionHeadline,
  parseBrandBrain,
} from "@/services/brand-brain.service";
import { findUnpaidCusoHiredBy } from "@/services/cmo-billing.service";
import { captureCmoHomepage } from "@/services/cmo-brand-media.service";
import { learnCmoBrandVisual } from "@/services/cmo-brand-visual.service";
import {
  CmoConflictError,
  CmoForbiddenError,
  type CmoLearningState,
  CUSO_BOT_WHERE,
  type Cuso,
  type CusoTarget,
  cmoBusinessNameFromUrl,
  cmoRunIsSlow,
  findCusoForBot,
  ONBOARDING_TURN_PREFIX,
  requireCuso,
  startCmoTurn,
} from "@/services/cmo-cuso.service";
import { documentCmoSitePages } from "@/services/cmo-site-pages.service";
import {
  linkTestCopyConnections,
  requireTestCopySource,
  tearDownTestCopyFor,
} from "@/services/cmo-test-copy.service";
import {
  cmoChangeKind,
  STRATEGY_TURN_PREFIX,
} from "@/services/marketing-strategy.service";
import { isTestCopyProject } from "@/services/project-test-copy";
import {
  settledTurnStatus,
  TURN_ROW_SELECT,
} from "@/services/soko-bot-turn-progress.service";

const CUSO_NAME = "Cuso";

/** Onboarding and strategy turns: owner asked, full work route. */
const CMO_ONBOARDING_ROUTE: PresetRoute = {
  route: "MANAGE_WORK",
  writeScope: "WORK",
  sandbox: true,
  reason: "CMO onboarding: learn the business and build the Brand Brain.",
};

/** The Project's name in Sokosumi: "CMO.xyz · Acme". */
export function cmoProjectName(businessName: string): string {
  return `CMO.xyz · ${businessName}`.slice(0, 120);
}

/**
 * A retry after a turn that saved sections but not the essentials: the
 * research is done, so Cuso only writes what is missing.
 */
function finishBrandBrainMessage(
  input: { businessName: string },
  inParts = false,
): string {
  return [
    `Your research on ${input.businessName} stopped before the Brand Brain essentials were saved. The profile sections you saved are kept.`,
    ...(inParts
      ? [
          "The groups still missing were researched again in parts before this message: their sections are saved, but your packet does not show them; their hand-overs below do.",
        ]
      : []),
    "",
    "Read the saved sections, then save the essentials with save_brand_brain (summary, voice, audience, products, offers, competitors, alternatives and channels), following your Brand Brain skill. Research again only what the essentials still need.",
    "Put what you could not confirm into the Brand Brain's yes/no questions, never into chat. End with one plain sentence on what stood out.",
    "The Brand Brain card is your report: do not call report_update, and never mention tools, tool limits or what you may not do this turn.",
  ].join("\n");
}

function onboardingMessage(input: {
  businessName: string;
  websiteUrl: string;
}): string {
  return [
    `New CMO client: ${input.businessName} (${input.websiteUrl}).`,
    "",
    "Learn the business and build its Brand Brain, following your Brand Brain skill: read the website, search for the company, its reviews, competitors, news and social profiles, and save each group of profile sections with save_brand_brain as soon as you have researched it, the essentials last. Write down only what you found, with the evidence, confidence, source and implication of every finding.",
    "Do not plan yet: the owner reviews the Brand Brain first, then asks you for the strategy.",
    "Put what you could not confirm into the Brand Brain's yes/no questions, never into chat. End with one plain sentence on what stood out.",
    "The Brand Brain card is your report: do not call report_update, and never mention tools, tool limits or what you may not do this turn.",
  ].join("\n");
}

/**
 * A first read on a version that reads in parts: Core ran one part per
 * research group before this message, so Cuso writes the essentials.
 */
function essentialsFromPartsMessage(input: {
  businessName: string;
  websiteUrl: string;
}): string {
  return [
    `New CMO client: ${input.businessName} (${input.websiteUrl}).`,
    "",
    "Your research ran in parts, one per group of your Brand Brain skill, side by side; each part saved its sections. Their hand-overs follow this message.",
    "Now save the essentials with save_brand_brain, with reveal, questions and marketingToday in the same call, following your Brand Brain skill. Draw them from the hand-overs; research again only what a hand-over left open, or a group whose part failed.",
    "Do not plan yet: the owner reviews the Brand Brain first, then asks you for the strategy.",
    "Put what you could not confirm into the Brand Brain's yes/no questions, never into chat. End with one plain sentence on what stood out.",
    "The Brand Brain card is your report: do not call report_update, and never mention tools, tool limits or what you may not do this turn.",
  ].join("\n");
}

/** The Brand Brain skill that reads in parts (SOKD-167). */
const PARTS_SKILL = "cmo-brand-brain-groups";

/** A research part reads the web and saves its sections; nothing else. */
const RESEARCH_PART_TOOLS = [
  "search_exa",
  "web_search",
  "web_fetch",
  "read_social_profile",
  "save_brand_brain",
] as const;

/** Whether a Cuso on this version reads the business in parts. */
function readsInParts(versionId: string | null): boolean {
  return (
    versionId !== null &&
    getSokoBotVersion(versionId).skills.includes(PARTS_SKILL)
  );
}

function researchPartMessage(
  cuso: Pick<Cuso, "businessName" | "websiteUrl">,
  group: (typeof CMO_RESEARCH_GROUPS)[number],
): string {
  return [
    `You are one part of your first read of ${cuso.businessName} (${cuso.websiteUrl}): the ${group.label} group, sections ${group.sections.join(", ")}. The other groups run at the same time.`,
    "",
    `Research it as "### ${group.label}" in your Brand Brain skill says, within its share of searches and page reads, running independent calls together in one step. Save these sections with save_brand_brain in sections as soon as you have researched them, never brandBrain, reveal, questions or marketingToday.`,
    "End with your hand-over, as the skill describes. Do not post in chat or call report_update.",
  ].join("\n");
}

/**
 * The parts a research turn runs before its message: one per research group
 * not yet saved, on a version that reads in parts, until the essentials
 * exist. A retry runs only the groups still missing.
 */
export function cmoResearchParts(
  versionId: string | null,
  cuso: Pick<Cuso, "businessName" | "websiteUrl" | "brandBrain">,
): TurnPart[] {
  if (!readsInParts(versionId) || parseBrandBrain(cuso.brandBrain)) return [];
  const saved = new Set(brandBrainSectionsSaved(cuso.brandBrain));
  return CMO_RESEARCH_GROUPS.filter(
    (group) => !group.sections.every((section) => saved.has(section)),
  ).map((group) => ({
    key: group.key,
    title: group.label,
    message: researchPartMessage(cuso, group),
    tools: RESEARCH_PART_TOOLS,
  }));
}

/** The parts of this turn, when it is a Cuso's research; none otherwise. */
/**
 * A first read in parts ends on the save that completes the essentials, with
 * the reveal's position as Cuso's answer: no closing model step after it.
 */
export function cmoResearchEndAnswer(
  turn: { clientTurnId: string | null; versionId: string | null },
  brain: {
    reveal?: { positioning: string } | null;
    questions: readonly unknown[];
    marketingToday?: unknown;
  } | null,
): string | undefined {
  if (!turn.clientTurnId?.startsWith(ONBOARDING_TURN_PREFIX)) return undefined;
  if (!readsInParts(turn.versionId)) return undefined;
  if (!brain?.reveal || brain.questions.length === 0 || !brain.marketingToday)
    return undefined;
  return brain.reveal.positioning;
}

export async function cmoTurnParts(turnId: string): Promise<TurnPart[]> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { sokoBotId: true, clientTurnId: true, versionId: true },
  });
  if (!turn?.clientTurnId?.startsWith(ONBOARDING_TURN_PREFIX)) return [];
  if (!readsInParts(turn.versionId)) return [];
  const cuso = await findCusoForBot(turn.sokoBotId);
  return cuso ? cmoResearchParts(turn.versionId, cuso) : [];
}

function newestResearchTurn(sokoBotId: string) {
  return prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId,
      clientTurnId: { startsWith: ONBOARDING_TURN_PREFIX },
    },
    orderBy: { createdAt: "desc" },
    select: TURN_ROW_SELECT,
  });
}

export async function cmoLearningState(
  cuso: Pick<Cuso, "sokoBotId" | "brandBrain">,
): Promise<CmoLearningState> {
  if (parseBrandBrain(cuso.brandBrain)) return "done";
  const turn = await newestResearchTurn(cuso.sokoBotId);
  // Cuso can finish without a Brand Brain on purpose: it asked questions.
  return turn ? settledTurnStatus(turn) : "failed";
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
  /** A strategy turn that fixes the Brand Brain or patches the plan; null for a whole plan. */
  change: "fix" | "patch" | null;
  status: CmoLearningState;
  startedAt: Date;
  steps: CmoWorkStep[];
  sections: CmoSectionHeadline[];
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
  if (capability === "save_strategy" || capability === "write_strategy") {
    return { kind: "strategy", label: "Writing your strategy", url: null };
  }
  if (capability === "list_project_social_accounts") {
    return { kind: "other", label: "Checking your accounts", url: null };
  }
  return null;
}

/** Cuso's latest research or strategy turn, step by step. */
export async function cmoWork(
  cuso: Pick<Cuso, "sokoBotId" | "websiteUrl" | "brandBrain">,
): Promise<CmoWork | null> {
  const turn = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: cuso.sokoBotId,
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
      cuso.websiteUrl,
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
  const sections = brandBrainSectionHeadlines(cuso.brandBrain);
  return {
    kind: turn.clientTurnId?.startsWith(STRATEGY_TURN_PREFIX)
      ? "strategy"
      : "research",
    change: cmoChangeKind(turn.clientTurnId),
    status: await settledTurnStatus(turn),
    startedAt: turn.createdAt,
    steps,
    sections,
    sectionsSaved: sections.length,
    sectionsTotal: CMO_BRAND_SECTION_KEYS.length,
  };
}

/** What Cuso is doing right now, for the chat and the hiring steps. */
export interface CmoActivity {
  /** The step he is on, in CMO's words; null before his first one. */
  step: string | null;
  /** The model's latest summary of its reasoning, when it gave one. */
  reasoning: string | null;
}

/** The turn Cuso is running now, whatever started it; null while he rests. */
export async function cmoActivity(
  cuso: Pick<Cuso, "sokoBotId" | "websiteUrl">,
): Promise<CmoActivity | null> {
  const turn = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: cuso.sokoBotId,
      status: { in: ["QUEUED", "STARTING", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, eveSessionId: true },
  });
  if (!turn) return null;
  // Read from the runtime's own log: a summary lands there as its step ends,
  // and reaches the turn's events only when the turn is next reconciled.
  const [call, thought] = await Promise.all([
    prisma.sokoBotToolCall.findFirst({
      where: { turnId: turn.id },
      orderBy: { createdAt: "desc" },
      select: { capability: true, input: true },
    }),
    turn.eveSessionId
      ? prisma.sokoBotRuntimeEvent.findFirst({
          where: {
            sessionId: turn.eveSessionId,
            type: "reasoning.completed",
            turnId: turn.id,
          },
          orderBy: { startIndex: "desc" },
          select: { data: true },
        })
      : null,
  ]);
  return {
    step: call
      ? (describeCmoStep(call.capability, call.input, cuso.websiteUrl)?.label ??
        cmoCapabilityLabel(call.capability))
      : null,
    reasoning: thought ? safeReasoningSummary(thought.data) : null,
  };
}

/**
 * Starts learning again after a failed or stuck first look, after one that
 * ended without the Brand Brain's essentials and asked nothing, or in place
 * of one running past twice the usual time.
 */
export async function retryCmoOnboarding(
  target: CusoTarget,
): Promise<{ turnId: string }> {
  const { userId } = target;
  const cuso = await requireCuso(target);
  if (parseBrandBrain(cuso.brandBrain)) {
    throw new CmoConflictError("Cuso already learned the business");
  }
  const turn = await newestResearchTurn(cuso.sokoBotId);
  if (turn && (await settledTurnStatus(turn)) === "running") {
    // createdAt is PostgreSQL time.
    if (!cmoRunIsSlow("research", turn.createdAt, await databaseNow())) {
      throw new CmoConflictError("Cuso is still learning the business");
    }
    const { sokoBotControlPlane } = await import(
      "@/services/soko-bot-control-plane.service"
    );
    await sokoBotControlPlane.expireTurn(turn.id);
  }
  const project = await prisma.project.findUnique({
    where: { id: cuso.projectId },
    select: { designMdUrl: true },
  });
  if (!project?.designMdUrl) {
    waitUntil(
      runAsBackgroundWork(() =>
        learnCmoBrandVisual(cuso).catch(() => undefined),
      ),
    );
  }
  return startCmoResearch(cuso, userId);
}

/**
 * The owner's time zone for this Cuso: his routines keep their local times
 * ("every day at 09:00") and move to the new zone, next runs included.
 */
export async function setCmoTimeZone(
  target: CusoTarget,
  timeZone: string,
): Promise<void> {
  const cuso = await requireCuso(target);
  await prisma.sokoBot.updateMany({
    where: { id: cuso.sokoBotId },
    data: { ingestTimezone: timeZone },
  });
  const { retimeSystemSchedules } = await import(
    "@/services/soko-bot-proactive.service"
  );
  await retimeSystemSchedules(cuso.sokoBotId, timeZone);
}

/**
 * Lets this person hire Cuso again for another website: the Cuso they work
 * with is archived, which stops his running work and cancels his posts that
 * have not gone out. His organization, Project and Files stay in Sokosumi.
 * Only an organization owner or admin may (the archive checks).
 */
export async function startCmoOver(target: CusoTarget): Promise<void> {
  // Start over on a test copy is its teardown, which whoever made it may do.
  if (await isTestCopyProject(target.projectId)) {
    await tearDownTestCopyFor(target);
    return;
  }
  const { userId } = target;
  const cuso = await requireCuso(target);
  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  await sokoBotControlPlane.archive(userId, cuso.workspaceId, {
    kind: "id",
    sokoBotId: cuso.sokoBotId,
  });
  // The next hire may land in this organization with a room of its own, so
  // this one is named after its website to tell the two apart.
  const bot = await prisma.sokoBot.findUnique({
    where: { id: cuso.sokoBotId },
    select: { sharedRoomId: true },
  });
  if (bot?.sharedRoomId) {
    await prisma.chatRoom.update({
      where: { id: bot.sharedRoomId },
      data: { name: `${CUSO_NAME} · ${cuso.businessName}`.slice(0, 80) },
    });
  }
}

/**
 * Starts Cuso's research turn for a hire, as the member `userId`; the CMO lab
 * reruns it per brand.
 */
export async function startCmoResearch(
  cuso: Cuso,
  userId: string,
  clientTurnId = `${ONBOARDING_TURN_PREFIX}${cuso.sokoBotId}:${Date.now()}`,
): Promise<{ turnId: string }> {
  const bot = await prisma.sokoBot.findUnique({
    where: { id: cuso.sokoBotId },
    select: { versionId: true },
  });
  const resuming = brandBrainSectionsSaved(cuso.brandBrain).length > 0;
  const inParts = readsInParts(bot?.versionId ?? null);
  return startCmoTurn(cuso, userId, {
    clientTurnId,
    message: resuming
      ? finishBrandBrainMessage(cuso, inParts)
      : inParts
        ? essentialsFromPartsMessage(cuso)
        : onboardingMessage(cuso),
    route: CMO_ONBOARDING_ROUTE,
  });
}

/**
 * The organization of a Cuso this person let go with "Use another website"
 * before approving any plan: hiring for the new website stays in it, so the
 * chat with the earlier Cuso stays beside the new one. Only theirs alone.
 */
async function organizationLeftWhileHiring(userId: string) {
  return prisma.organization.findFirst({
    where: {
      members: {
        every: { userId },
        some: { userId, role: "owner" },
      },
      workspace: {
        is: {
          projects: {
            some: {
              sokoBots: {
                some: { ...CUSO_BOT_WHERE, archivedAt: { not: null } },
              },
            },
            none: {
              OR: [
                {
                  marketingStrategies: { some: { approvedAt: { not: null } } },
                },
                {
                  sokoBots: {
                    some: {
                      ...CUSO_BOT_WHERE,
                      archivedAt: null,
                      deletedAt: null,
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, metadata: true },
  });
}

/**
 * The workspace a hire goes into when the person chose none: a new
 * organization named after the business, made preferred as before. A retry
 * after a failed hire, and hiring again after "Use another website" while
 * hiring, reuse the organization they left (ADR 0065: only here).
 */
async function newOrganizationWorkspace(input: {
  userId: string;
  websiteUrl: string;
  businessName: string;
}) {
  const { userId, websiteUrl, businessName } = input;
  // A hire that failed after its organization existed left it empty; a
  // retry takes it instead of making a second one.
  const leftover = await prisma.organization.findFirst({
    where: {
      name: businessName,
      members: {
        every: { userId },
        some: { userId, role: "owner" },
      },
      workspace: { is: { projects: { none: {} } } },
    },
    select: { id: true, metadata: true },
  });
  const reused = leftover ?? (await organizationLeftWhileHiring(userId));
  if (reused && reused.id !== leftover?.id) {
    await prisma.organization.update({
      where: { id: reused.id },
      data: {
        name: businessName,
        metadata: JSON.stringify(
          buildOrganizationMetadataWithUrl(
            parseOrganizationMetadata(reused.metadata),
            websiteUrl,
          ) ?? {},
        ),
      },
    });
  }
  if (reused) return getUserWorkspace(userId, { organizationId: reused.id });
  // Loaded here: Better Auth's module graph stays out of the CMO service's.
  const { createOrganizationWorkspace } = await import(
    "@/helpers/organization-workspace"
  );
  return createOrganizationWorkspace(userId, {
    name: businessName,
    websiteUrl,
  });
}

/**
 * The workspace of an organization the person chose to hire into (ADR
 * 0065): any member may. It stays as it is (name, plan, settings, the
 * person's preferred organization).
 */
async function existingOrganizationWorkspace(input: {
  userId: string;
  organizationId: string;
}) {
  const { userId, organizationId } = input;
  const member = await prisma.member.findFirst({
    where: { userId, organizationId },
    select: { id: true },
  });
  if (!member) {
    throw new CmoForbiddenError(
      "You're not a member of that organization",
      CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED,
    );
  }
  return getUserWorkspace(userId, { organizationId });
}

/**
 * A hire costs the organization nothing (free hiring, ADR 0068), so only the
 * hirer's Seat is checked.
 */
async function requireHirerSeat(
  userId: string,
  organizationId: string,
): Promise<void> {
  const { requireMemberSeat, SokoBotBillingAccessError } = await import(
    "@/services/soko-bot-billing.service"
  );
  try {
    await requireMemberSeat(userId, organizationId);
  } catch (error) {
    if (!(error instanceof SokoBotBillingAccessError)) throw error;
    throw new CmoForbiddenError(
      "You need a Seat in that organization to hire Cuso",
      CORE_API_ERROR_KINDS.ORGANIZATION_SEAT_REQUIRED,
    );
  }
}

/**
 * One unpaid Cuso per person (ADR 0068): the refusal names him for CMO's link.
 * A tester may continue any Cuso on Tester credits anyway, so the cap would
 * only stop them hiring two Cusos to compare before approving either.
 */
async function requireNoUnpaidCuso(userId: string): Promise<void> {
  if (
    await isOnEmailAllowlist(userId, getEnv().CMO_SUBSCRIPTION_SKIP_ALLOWLIST, {
      requireVerifiedEmail: true,
    })
  )
    return;
  const unpaid = await findUnpaidCusoHiredBy(userId);
  if (!unpaid) return;
  throw new CmoConflictError(
    `Your Cuso for ${unpaid.businessName} is not subscribed yet. Subscribe or start him over before you hire another.`,
    CORE_API_ERROR_KINDS.CMO_UNPAID_CUSO,
    { unpaidCuso: unpaid },
  );
}

/**
 * Whether this person may hire Cuso while CMO is invite-only: the email Core
 * holds for them, verified, or its `@domain`, is on `CMO_HIRE_ALLOWLIST`.
 * Everything else in CMO stays open to whoever already works with a Cuso.
 */
export async function mayHireCuso(userId: string): Promise<boolean> {
  // Each hire's research and plan are free, and anyone can register an
  // unverified address at a listed domain. Gates new hires only: a person's
  // existing Cusos open whatever this says.
  return await isOnEmailAllowlist(userId, getEnv().CMO_HIRE_ALLOWLIST, {
    requireVerifiedEmail: true,
  });
}

/**
 * Hires Cuso (ADR 0065): into a new organization named after the business,
 * or into `organizationId`, one the person belongs to. Either way a new
 * marketing Project gets Cuso as its shared bot (ADR 0061) and his first
 * turn starts, free until his strategy is approved (ADR 0068). A person with
 * an unpaid Cuso is refused another (409). Hiring never hands back a
 * Cuso the person already works with; a Project that has one refuses a
 * second (409).
 */
export async function startCmoOnboarding(input: {
  userId: string;
  websiteUrl: string;
  organizationId?: string | undefined;
  /** The owner's time zone, from their browser. */
  timeZone?: string | undefined;
  /** Hire a test copy of this Project's Cuso, in his organization (ADR 0073). */
  testCopyOfProjectId?: string | undefined;
}): Promise<Cuso> {
  // shortcut: two racing submits can hire twice, in two organizations or in
  // one; the start form submits once. Add a per-person lock if duplicates
  // show up.

  // Before anything exists: each hire's research and plan are free.
  if (!(await mayHireCuso(input.userId))) {
    throw new CmoForbiddenError(
      "CMO is invite-only for now",
      CORE_API_ERROR_KINDS.CMO_HIRE_NOT_ALLOWED,
    );
  }
  await requireNoUnpaidCuso(input.userId);
  const sourceProjectId = input.testCopyOfProjectId;
  // A test copy goes into its source's organization, whatever was asked.
  const organizationId = sourceProjectId
    ? await requireTestCopySource({
        userId: input.userId,
        sourceProjectId,
        organizationId: input.organizationId,
      })
    : input.organizationId;
  // Organization names take 2 to 50 characters.
  const businessName = cmoBusinessNameFromUrl(input.websiteUrl)
    .slice(0, 50)
    .padEnd(2, ".");
  const workspace = organizationId
    ? await existingOrganizationWorkspace({
        userId: input.userId,
        organizationId,
      })
    : await newOrganizationWorkspace({ ...input, businessName });
  if (!workspace.organizationId)
    throw new Error("Cuso's workspace has no organization");
  await requireHirerSeat(input.userId, workspace.organizationId);

  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      name: sourceProjectId
        ? `${cmoProjectName(businessName).slice(0, 108)} (test copy)`
        : cmoProjectName(businessName),
      websiteUrl: input.websiteUrl,
      testCopyOfProjectId: sourceProjectId ?? null,
    },
    select: { id: true },
  });

  let created: Cuso;
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
      ...(input.timeZone ? { timezone: input.timeZone } : {}),
    });
    sharedRoomId = bot.sharedRoomId;
    const cuso = await findCusoForBot(bot.id);
    if (!cuso) throw new Error("Cuso was not created");
    created = cuso;
    if (sourceProjectId) {
      await linkTestCopyConnections({
        projectId: project.id,
        sourceProjectId,
        actorId: input.userId,
      });
    }
  } catch (error) {
    // No stray Project, Cuso or room: deleting the Project cascades to his
    // bot, which only lets go of its shared room. The Project is the one made
    // above, so a refusal never touches another Project's Cuso.
    if (sharedRoomId)
      await prisma.chatRoom
        .delete({ where: { id: sharedRoomId } })
        .catch(() => undefined);
    await deleteFailedHireProject(prisma, project.id).catch((cleanupError) => {
      recordCoreWarning(
        { operation: "cmo_hire_cleanup", project: { id: project.id } },
        {
          message: "Could not delete the Project of a failed Cuso hire",
          why: "The database delete failed",
          fix: "Delete the Project under project.id by hand; it holds no Cuso. Read the database error under warnings[].cause.",
          cause: cleanupError,
        },
      );
    });
    throw error;
  }

  // The brand's look (logo, colours, fonts, DESIGN.md) is read alongside
  // Cuso's research; it never holds up onboarding.
  waitUntil(
    runAsBackgroundWork(() =>
      learnCmoBrandVisual(created).catch((error) => {
        emitCoreWarning(
          {
            operation: "cmo_brand_visual",
            sokoBot: { id: created.sokoBotId },
            failure: messageSafeErrorFields(error),
          },
          {
            message: "Could not learn the brand's look for a new Cuso",
            why: "Reading the logo, colours, fonts and DESIGN.md threw",
            fix: "Onboarding goes on without them; retrying Cuso's onboarding reads them again. If it repeats, look up the error name and code under failure.",
          },
        );
      }),
    ),
  );
  // The homepage screenshots need no research either, so the Brand Brain
  // opens with them instead of waiting for the full capture.
  waitUntil(
    runAsBackgroundWork(() =>
      captureCmoHomepage(created)
        // Then the whole site, so research and the Brand Brain can use it.
        .then(() => documentCmoSitePages(created.sokoBotId))
        .catch((error) => {
          emitCoreWarning(
            {
              operation: "cmo_homepage_capture",
              sokoBot: { id: created.sokoBotId },
              failure: messageSafeErrorFields(error),
            },
            {
              message: "Could not capture the brand's homepage for a new Cuso",
              why: "The homepage screenshot capture threw",
              fix: "The Brand Brain waits for the full capture after research instead. If it repeats, look up the error name and code under failure.",
            },
          );
        }),
    ),
  );

  // A turn that cannot start (no Seat, Cuso busy) leaves the hire ready:
  // the learning card offers Try again and says why when it fails again.
  await startCmoResearch(
    created,
    input.userId,
    `${ONBOARDING_TURN_PREFIX}${created.sokoBotId}`,
  ).catch((error) => {
    // A turn's error can quote its prompt, so only its name and code.
    recordCoreWarning(
      { operation: "cmo_onboarding_turn", sokoBot: { id: created.sokoBotId } },
      {
        message: "Cuso's onboarding turn did not start",
        why: "Starting the research turn failed",
        fix: "The hire stays ready: the learning card offers Try again. If it repeats, look up the error name and code under failure.",
      },
      { failure: messageSafeErrorFields(error) },
    );
  });

  return created;
}
