import { type CmoHire } from "@sokosumi/database";
import {
  CMO_BRAND_SECTION_KEYS,
  CMO_BRAND_SECTIONS,
  CMO_SOKO_BOT_VERSION_ID,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { getEnv } from "@/config/env";
import { buildCreditsPayload } from "@/helpers/subscription";
import { getUserWorkspace } from "@/helpers/user-workspaces";
import prisma from "@/lib/db/prisma";
import { type PresetRoute } from "@/lib/soko-bot/classifier";
import {
  cmoBrandSectionsSaved,
  parseCmoBrandBrain,
} from "@/services/cmo-brand-brain.service";
import { learnCmoBrandVisual } from "@/services/cmo-brand-visual.service";
import {
  CMO_HIRE_PROJECT,
  CMO_OUT_OF_CREDITS,
  CmoConflictError,
  type CmoHireView,
  type CmoLearningState,
  CmoNotFoundError,
  cmoBusinessNameFromUrl,
  cmoHireView,
  getCmoHireForUser,
  ONBOARDING_TURN_PREFIX,
  STRATEGY_TURN_PREFIX,
  settledTurnStatus,
  startCmoProduction,
  startCmoTurn,
  TURN_ROW_SELECT,
} from "@/services/cmo-cuso.service";
import { approvedMarketingStrategy } from "@/services/marketing-strategy.service";

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
  hire: Pick<CmoHireView, "sokoBotId" | "brandBrain">,
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
  hire: Pick<CmoHireView, "sokoBotId" | "websiteUrl" | "brandBrain">,
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
  if (!(await approvedMarketingStrategy(hire.projectId))) {
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
  if (!(await approvedMarketingStrategy(hire.projectId))) {
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
  hire: CmoHireView,
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

  let created: CmoHireView;
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
    created = cmoHireView(
      await prisma.cmoHire.create({
        data: { sokoBotId: bot.id, projectId: project.id },
        include: CMO_HIRE_PROJECT,
      }),
    );
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
    message: onboardingMessage(created),
    route: CMO_ONBOARDING_ROUTE,
  }).catch((error) => {
    console.warn("CMO onboarding turn did not start", {
      cmoHireId: created.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  });

  return created;
}
