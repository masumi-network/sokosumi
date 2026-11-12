import {
  CMO_BRAND_SECTION_KEYS,
  CMO_BRAND_SECTIONS,
  CMO_SOKO_BOT_VERSION_ID,
} from "@sokosumi/soko-bot";
import {
  buildOrganizationMetadataWithUrl,
  CORE_API_ERROR_KINDS,
  parseOrganizationMetadata,
} from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import { getEnv } from "@/config/env";
import { getUserWorkspace } from "@/helpers/user-workspaces";
import prisma from "@/lib/db/prisma";
import { type PresetRoute } from "@/lib/soko-bot/classifier";
import {
  brandBrainSectionHeadlines,
  brandBrainSectionsSaved,
  type CmoSectionHeadline,
  parseBrandBrain,
} from "@/services/brand-brain.service";
import {
  CMO_STARTER_CREDITS,
  grantCmoStarterCredits,
} from "@/services/cmo-billing.service";
import { captureCmoHomepage } from "@/services/cmo-brand-media.service";
import { learnCmoBrandVisual } from "@/services/cmo-brand-visual.service";
import {
  CMO_OUT_OF_CREDITS,
  CmoConflictError,
  CmoForbiddenError,
  type CmoLearningState,
  CUSO_BOT_WHERE,
  type Cuso,
  type CusoTarget,
  cmoBusinessNameFromUrl,
  findCusoForBot,
  ONBOARDING_TURN_PREFIX,
  requireCuso,
  startCmoTurn,
} from "@/services/cmo-cuso.service";
import { STRATEGY_TURN_PREFIX } from "@/services/marketing-strategy.service";
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
function finishBrandBrainMessage(input: { businessName: string }): string {
  return [
    `Your research on ${input.businessName} stopped before the Brand Brain essentials were saved. The profile sections you saved are kept.`,
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

export async function cmoLearningState(
  cuso: Pick<Cuso, "sokoBotId" | "brandBrain">,
  now: Date = new Date(),
): Promise<CmoLearningState> {
  if (parseBrandBrain(cuso.brandBrain)) return "done";
  const turn = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: cuso.sokoBotId,
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
  cuso: Pick<Cuso, "sokoBotId" | "websiteUrl" | "brandBrain">,
  now: Date = new Date(),
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
    status: await settledTurnStatus(turn, now),
    startedAt: turn.createdAt,
    steps,
    sections,
    sectionsSaved: sections.length,
    sectionsTotal: CMO_BRAND_SECTION_KEYS.length,
  };
}

/**
 * Starts learning again after a failed or stuck first look, or after one that
 * ended without the Brand Brain's essentials and asked nothing.
 */
export async function retryCmoOnboarding(
  target: CusoTarget,
): Promise<{ turnId: string }> {
  const { userId } = target;
  const cuso = await requireCuso(target);
  const state = await cmoLearningState(cuso);
  if (state === "running") {
    throw new CmoConflictError("Cuso is still learning the business");
  }
  if (parseBrandBrain(cuso.brandBrain)) {
    throw new CmoConflictError("Cuso already learned the business");
  }
  const project = await prisma.project.findUnique({
    where: { id: cuso.projectId },
    select: { designMdUrl: true },
  });
  if (!project?.designMdUrl) {
    waitUntil(learnCmoBrandVisual(cuso).catch(() => undefined));
  }
  return startCmoResearch(cuso, userId);
}

/** Social posts Cuso planned that have not gone out. */
const UNSENT_POST_STATUSES = ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"] as const;

/**
 * Lets this person hire Cuso again for another website: the Cuso they work
 * with is archived (his running work stops) and his posts that have not gone
 * out are canceled. His organization, Project and Files stay in Sokosumi.
 * Only an organization owner or admin may (the archive checks).
 */
export async function startCmoOver(target: CusoTarget): Promise<void> {
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
  const posts = await prisma.socialPost.findMany({
    where: {
      projectId: cuso.projectId,
      status: { in: [...UNSENT_POST_STATUSES] },
    },
    select: { id: true, revision: true },
  });
  const { cancelSocialPost } = await import("@/services/social-posts.service");
  for (const post of posts) {
    await cancelSocialPost({
      projectId: cuso.projectId,
      workspaceId: cuso.workspaceId,
      userId,
      postId: post.id,
      revision: post.revision,
    }).catch((error) => {
      console.warn("Starting over left a Social post", {
        postId: post.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    });
  }
}

/**
 * Starts Cuso's research turn for a hire, as the member `userId`; the CMO lab
 * reruns it per brand.
 */
export function startCmoResearch(
  cuso: Cuso,
  userId: string,
): Promise<{ turnId: string }> {
  return startCmoTurn(cuso, userId, {
    clientTurnId: `${ONBOARDING_TURN_PREFIX}${cuso.sokoBotId}:${Date.now()}`,
    message:
      brandBrainSectionsSaved(cuso.brandBrain).length > 0
        ? finishBrandBrainMessage(cuso)
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

/** The hirer's first turn can spend the starter credits from a successful hire. */
async function requireHirerFunding(
  userId: string,
  organizationId: string,
): Promise<void> {
  const { requireMemberTurnFunding, SokoBotBillingAccessError } = await import(
    "@/services/soko-bot-billing.service"
  );
  try {
    await requireMemberTurnFunding(userId, organizationId, CMO_STARTER_CREDITS);
  } catch (error) {
    if (!(error instanceof SokoBotBillingAccessError)) throw error;
    if (error.reason === "seat") {
      throw new CmoForbiddenError(
        "You need a Seat in that organization to hire Cuso",
        CORE_API_ERROR_KINDS.ORGANIZATION_SEAT_REQUIRED,
      );
    }
    throw new CmoConflictError(
      CMO_OUT_OF_CREDITS,
      CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
    );
  }
}

/**
 * Whether this person may hire Cuso while CMO is invite-only: the email Core
 * holds for them, or its `@domain`, is on `CMO_HIRE_ALLOWLIST`. Everything
 * else in CMO stays open to whoever already works with a Cuso.
 */
export async function mayHireCuso(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const email = user?.email.trim().toLowerCase();
  if (!email) return false;
  const domain = email.slice(email.lastIndexOf("@"));
  return getEnv().CMO_HIRE_ALLOWLIST.some(
    (entry) => entry === email || entry === domain,
  );
}

/**
 * Hires Cuso (ADR 0065): into a new organization named after the business,
 * or into `organizationId`, one the person belongs to. Either way a new
 * marketing Project gets Cuso as its shared bot (ADR 0061), his organization
 * gets starter credits, and his first turn starts. Hiring never hands back a
 * Cuso the person already works with; a Project that has one refuses a
 * second (409).
 */
export async function startCmoOnboarding(input: {
  userId: string;
  websiteUrl: string;
  organizationId?: string | undefined;
}): Promise<Cuso> {
  // shortcut: two racing submits can hire twice, in two organizations or in
  // one; the start form submits once. Add a per-person lock if duplicates
  // show up.

  // Before anything exists: each hire grants starter credits (ADR 0065).
  if (!(await mayHireCuso(input.userId))) {
    throw new CmoForbiddenError(
      "CMO is invite-only for now",
      CORE_API_ERROR_KINDS.CMO_HIRE_NOT_ALLOWED,
    );
  }
  // Organization names take 2 to 50 characters.
  const businessName = cmoBusinessNameFromUrl(input.websiteUrl)
    .slice(0, 50)
    .padEnd(2, ".");
  const workspace = input.organizationId
    ? await existingOrganizationWorkspace({
        userId: input.userId,
        organizationId: input.organizationId,
      })
    : await newOrganizationWorkspace({ ...input, businessName });
  const organizationId = workspace.organizationId;
  if (!organizationId) throw new Error("Cuso's workspace has no organization");
  // Check Seat and spendable credits before creating a Project, including
  // the starter credits the organization receives when the hire succeeds.
  await requireHirerFunding(input.userId, organizationId);

  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      name: cmoProjectName(businessName),
      websiteUrl: input.websiteUrl,
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
    });
    sharedRoomId = bot.sharedRoomId;
    const cuso = await findCusoForBot(bot.id);
    if (!cuso) throw new Error("Cuso was not created");
    await grantCmoStarterCredits({ projectId: project.id, organizationId });
    created = cuso;
  } catch (error) {
    // No stray Project, Cuso or room: deleting the Project cascades to his
    // bot, which only lets go of its shared room. The Project is the one made
    // above, so a refusal never touches another Project's Cuso.
    if (sharedRoomId)
      await prisma.chatRoom
        .delete({ where: { id: sharedRoomId } })
        .catch(() => undefined);
    await prisma.project
      .delete({ where: { id: project.id } })
      .catch((cleanupError) => {
        console.warn("Hiring Cuso cleanup failed", {
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
        sokoBotId: created.sokoBotId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }),
  );
  // The homepage screenshots need no research either, so the Brand Brain
  // opens with them instead of waiting for the full capture.
  waitUntil(
    captureCmoHomepage(created).catch((error) => {
      console.warn("CMO homepage capture failed", {
        sokoBotId: created.sokoBotId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }),
  );

  // A turn that cannot start (no credits yet) leaves the hire ready:
  // the learning card offers Try again and says why when it fails again.
  await startCmoTurn(created, input.userId, {
    clientTurnId: `${ONBOARDING_TURN_PREFIX}${created.sokoBotId}`,
    message: onboardingMessage(created),
    route: CMO_ONBOARDING_ROUTE,
  }).catch((error) => {
    console.warn("CMO onboarding turn did not start", {
      sokoBotId: created.sokoBotId,
      error: error instanceof Error ? error.message : "unknown",
    });
  });

  return created;
}
