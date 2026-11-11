import { z } from "@hono/zod-openapi";
import { MemberRole, type Prisma } from "@sokosumi/database";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { CORE_API_ERROR_KINDS, type CoreApiErrorKind } from "@sokosumi/utils";
import { conflict } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { requireProjectAccessForUser } from "@/lib/image-studio/access";
import { type PresetRoute } from "@/lib/soko-bot/classifier";
import type { SettledTurnStatus } from "@/services/soko-bot-turn-progress.service";

/**
 * CMO.xyz (Cuso) on Soko Bots. Each hire puts Cuso in a new Project of a new
 * or an existing organization (ADR 0065), as an ordinary Soko Bot, so every
 * existing seam — turns, schedules, chat, Social, Content Studio, Tasks —
 * works unchanged. The `cmo-*.service` modules add what CMO needs on
 * top: onboarding, the Brand Brain and strategy records, the subscription
 * gate, and the packets Cuso's rhythms read. This one finds a person's or a
 * bot's Cuso, who pays for him, and starts and reads his turns.
 */

/** A CMO refusal; `kind` is the stable error kind CMO matches on, if any. */
export class CmoError extends Error {
  constructor(
    message: string,
    readonly kind?: CoreApiErrorKind,
  ) {
    super(message);
  }
}
export class CmoNotFoundError extends CmoError {}
export class CmoConflictError extends CmoError {}
export class CmoForbiddenError extends CmoError {}

/**
 * Who pays for Cuso and whose plan opens execution: his Project's
 * organization, where every hire goes (ADR 0065).
 */
export async function cmoPayer(
  cuso: Pick<Cuso, "workspaceId">,
): Promise<{ organizationId: string; referenceId: string }> {
  const row = await prisma.workspace.findUnique({
    where: { id: cuso.workspaceId },
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

/**
 * Cuso is found, not linked (ADR 0062): a shared Soko Bot of a Project on
 * CMO's version. Hiring Cuso makes at most one per Project.
 */
export const CUSO_BOT_WHERE = {
  versionId: { in: [...CMO_SOKO_BOT_VERSION_IDS] },
  userId: null,
  projectId: { not: null },
} satisfies Prisma.SokoBotWhereInput;

/** A Cuso nobody deleted or archived: the one people work with. */
const LIVE_CUSO_WHERE = {
  ...CUSO_BOT_WHERE,
  deletedAt: null,
  archivedAt: null,
} satisfies Prisma.SokoBotWhereInput;

/** True while the Project has a live Cuso: a CMO Project (ADR 0066). */
export async function isCmoProject(projectId: string): Promise<boolean> {
  const bot = await prisma.sokoBot.findFirst({
    where: { ...LIVE_CUSO_WHERE, projectId },
    select: { id: true },
  });
  return bot !== null;
}

/** Which of these Projects are CMO Projects, in one query for a list. */
export async function cmoProjectIds(
  projectIds: readonly string[],
): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const bots = await prisma.sokoBot.findMany({
    where: { ...LIVE_CUSO_WHERE, projectId: { in: [...projectIds] } },
    select: { projectId: true },
  });
  return new Set(bots.flatMap(({ projectId }) => projectId ?? []));
}

/**
 * Refuses a write to a CMO Project from anywhere but `/v1/cmo/**` (ADR
 * 0066). Core's own CMO services write through Prisma and never call it.
 * Only a Project in the caller's workspace counts: for any other the route
 * answers its own 404, so the refusal never tells a stranger it is CMO's.
 */
export async function requireNotCmoProject(
  projectId: string,
  workspaceId: string,
): Promise<void> {
  // Not a uuid, so no Project: the route itself answers 404 or 422.
  if (!z.uuid().safeParse(projectId).success) return;
  const cuso = await prisma.sokoBot.findFirst({
    where: { ...LIVE_CUSO_WHERE, projectId, project: { workspaceId } },
    select: { id: true },
  });
  if (cuso) {
    throw conflict("This Project is managed by CMO. Change it in CMO.", {
      kind: CORE_API_ERROR_KINDS.CMO_PROJECT_READ_ONLY,
    });
  }
}

/**
 * Refuses a change to Cuso through the Soko Bot routes (ADR 0066), archived
 * or not: reactivating him from Sokosumi would bring a Project back under
 * CMO without CMO. Like `requireNotCmoProject`, only in the caller's
 * workspace; elsewhere the route answers its own 404.
 */
export async function requireNotCuso(
  sokoBotId: string,
  workspaceId: string,
): Promise<void> {
  const bot = await prisma.sokoBot.findFirst({
    where: { id: sokoBotId, workspaceId, ...CUSO_BOT_WHERE },
    select: { id: true },
  });
  if (bot) {
    throw conflict("Cuso is managed by CMO. Change him in CMO.", {
      kind: CORE_API_ERROR_KINDS.CMO_PROJECT_READ_ONLY,
    });
  }
}

/** What a Cuso read selects, for `cusoView`. */
const CUSO_SELECT = {
  id: true,
  createdAt: true,
  project: {
    select: {
      id: true,
      workspaceId: true,
      websiteUrl: true,
      workspace: { select: { organizationId: true } },
      brandBrain: {
        select: { body: true, updatedAt: true, confirmedAt: true },
      },
    },
  },
} as const satisfies Prisma.SokoBotSelect;

type CusoRow = Prisma.SokoBotGetPayload<{ select: typeof CUSO_SELECT }>;

/**
 * Cuso with what he reads off his Project, which keeps no copy: the
 * workspace (the business's organization, which pays), the website, the
 * business name (the website's host), and the Project's Brand Brain under
 * the names CMO's screens read. `createdAt` is when he was hired.
 */
export interface Cuso {
  sokoBotId: string;
  projectId: string;
  createdAt: Date;
  workspaceId: string;
  websiteUrl: string;
  businessName: string;
  brandBrain: Prisma.JsonValue | null;
  brandBrainUpdatedAt: Date | null;
  brandBrainConfirmedAt: Date | null;
}

/** Null for a bot without a Project, which `CUSO_BOT_WHERE` never returns. */
function cusoView({ id, createdAt, project }: CusoRow): Cuso | null {
  if (!project) return null;
  const websiteUrl = project.websiteUrl ?? "";
  return {
    sokoBotId: id,
    projectId: project.id,
    createdAt,
    workspaceId: project.workspaceId,
    websiteUrl,
    businessName: cmoBusinessNameFromUrl(websiteUrl),
    brandBrain: project.brandBrain?.body ?? null,
    brandBrainUpdatedAt: project.brandBrain?.updatedAt ?? null,
    brandBrainConfirmedAt: project.brandBrain?.confirmedAt ?? null,
  };
}

/** One Cuso a person can work with, as the Cuso picker shows him. */
export interface CusoListItem {
  projectId: string;
  businessName: string;
  websiteUrl: string;
  projectLogo: string | null;
  organizationId: string;
  organizationName: string;
  /** No plan of his is approved yet: he is still being hired. */
  hiring: boolean;
  createdAt: Date;
}

/**
 * Every live Cuso in the person's organizations, newest first (ADR 0065):
 * CMO picks among them.
 */
export async function listCusosForUser(
  userId: string,
): Promise<CusoListItem[]> {
  const bots = await prisma.sokoBot.findMany({
    where: {
      ...LIVE_CUSO_WHERE,
      project: {
        workspace: { organization: { members: { some: { userId } } } },
      },
    },
    select: {
      id: true,
      createdAt: true,
      project: {
        select: {
          id: true,
          websiteUrl: true,
          logo: true,
          workspace: {
            select: { organization: { select: { id: true, name: true } } },
          },
          marketingStrategies: {
            where: { approvedAt: { not: null } },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return bots.flatMap(({ createdAt, project }) => {
    const organization = project?.workspace.organization;
    if (!project || !organization) return [];
    const websiteUrl = project.websiteUrl ?? "";
    return [
      {
        projectId: project.id,
        businessName: cmoBusinessNameFromUrl(websiteUrl),
        websiteUrl,
        projectLogo: project.logo,
        organizationId: organization.id,
        organizationName: organization.name,
        hiring: project.marketingStrategies.length === 0,
        createdAt,
      },
    ];
  });
}

/**
 * The Cuso of the Project a member named, as CMO's Project-scoped routes
 * act on him: 404 (as the Project routes answer) unless the Project exists
 * and the caller is still a member of its organization; null when the
 * Project has no live Cuso.
 */
export async function findCusoForProject(
  where: { userId: string; projectId: string },
  db: Prisma.TransactionClient = prisma,
): Promise<Cuso | null> {
  const { organizationId } = await requireProjectAccessForUser(where, db);
  if (!organizationId) return null;
  const bot = await db.sokoBot.findFirst({
    where: { ...LIVE_CUSO_WHERE, projectId: where.projectId },
    select: CUSO_SELECT,
  });
  return bot ? cusoView(bot) : null;
}

/** This bot as Cuso, or null for any bot that is not one. */
export async function findCusoForBot(
  sokoBotId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<Cuso | null> {
  const bot = await db.sokoBot.findFirst({
    where: { id: sokoBotId, ...CUSO_BOT_WHERE },
    select: CUSO_SELECT,
  });
  return bot ? cusoView(bot) : null;
}

/** Every live Cuso whose Project has an approved Marketing strategy. */
export async function listCusosWithApprovedStrategy(): Promise<Cuso[]> {
  const bots = await prisma.sokoBot.findMany({
    where: {
      ...LIVE_CUSO_WHERE,
      project: {
        marketingStrategies: { some: { approvedAt: { not: null } } },
      },
    },
    select: CUSO_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return bots.flatMap((bot) => cusoView(bot) ?? []);
}

/** Paid and approved: Cuso makes the whole month now (cmo-production.service). */
export async function startCmoProduction(sokoBotId: string): Promise<void> {
  const { kickCmoProduction } = await import(
    "@/services/cmo-production.service"
  );
  kickCmoProduction(sokoBotId);
}

/** A Project's Cuso, if it has one, makes its newly approved month. */
export async function startCmoProductionForProject(
  projectId: string,
): Promise<void> {
  const cuso = await prisma.sokoBot.findFirst({
    where: { ...LIVE_CUSO_WHERE, projectId },
    select: { id: true },
  });
  if (cuso) await startCmoProduction(cuso.id);
}

/** What the founder reads when a step cannot start for lack of credits. */
export const CMO_OUT_OF_CREDITS = "You're out of credits";

/** A turn of Cuso's that `userId`, a member of his organization, started. */
export async function startCmoTurn(
  cuso: Pick<Cuso, "workspaceId" | "sokoBotId">,
  userId: string,
  input: { clientTurnId: string; message: string; route: PresetRoute },
): Promise<{ turnId: string }> {
  // The founder pressed the button and sees the refusal there, so the
  // control plane's out-of-credits chat notice would only repeat it.
  const { requireSokoBotTurnFunding, SokoBotBillingAccessError } = await import(
    "@/services/soko-bot-billing.service"
  );
  try {
    await requireSokoBotTurnFunding(userId, cuso.sokoBotId);
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
    workspaceId: cuso.workspaceId,
    // Cuso, never the member's personal assistant in the same workspace.
    sokoBotId: cuso.sokoBotId,
    clientTurnId: input.clientTurnId,
    message: input.message,
    // A member pressed the button, but no chat message carries the turn:
    // EVENT delivers the answer to Cuso's shared room.
    source: "EVENT",
    presetRoute: input.route,
    personStarted: true,
  });
  return { turnId: started.turnId };
}

export const ONBOARDING_TURN_PREFIX = "cmo:onboarding:";

/** Where Cuso's first look at the business stands, for the learning card. */
export type CmoLearningState = SettledTurnStatus;

/**
 * The member Cuso's own runs act as (his rhythms, the month's production, the
 * brand capture): who hired him while they are still a member of the
 * business, else its longest-standing owner or admin, so a hirer who left
 * never stalls the business's month (ADR 0061). Null only for an organization
 * with neither.
 */
export async function cmoRunnerUserId(
  cuso: Pick<Cuso, "workspaceId" | "sokoBotId">,
): Promise<string | null> {
  const [{ organizationId }, bot] = await Promise.all([
    cmoPayer(cuso),
    prisma.sokoBot.findUnique({
      where: { id: cuso.sokoBotId },
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

/** Who a CMO call names: a member and the Project of the Cuso they act on. */
export interface CusoTarget {
  userId: string;
  projectId: string;
}

/**
 * A write's target: the Cuso a CMO call names (`findCusoForProject`), or the
 * bot itself.
 */
export async function requireCuso(
  where: CusoTarget | { sokoBotId: string },
  db: Prisma.TransactionClient = prisma,
): Promise<Cuso> {
  const cuso =
    "sokoBotId" in where
      ? await findCusoForBot(where.sokoBotId, db)
      : await findCusoForProject(where, db);
  if (!cuso) throw new CmoNotFoundError("Cuso is not hired yet");
  return cuso;
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
