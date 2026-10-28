import { MemberRole, type Prisma } from "@sokosumi/database";
import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { type PresetRoute } from "@/lib/soko-bot/classifier";

/**
 * CMO.xyz (Cuso) on Soko Bots. Cuso works in the Workspace the person chose
 * (ADR 0053), as an ordinary Soko Bot in a Project of his own, so every
 * existing seam — turns, schedules, chat, Social, Content Studio, Tasks —
 * works unchanged. The `cmo-*.service` modules add what CMO needs on
 * top: onboarding, the Brand Brain and strategy records, the subscription
 * gate, and the packets Cuso's rhythms read. This one finds a person's or a
 * bot's Cuso, who pays for him, and starts and reads his turns.
 */

export class CmoNotFoundError extends Error {}
export class CmoConflictError extends Error {}
export class CmoForbiddenError extends Error {}

/**
 * Who pays for Cuso and whose plan opens execution: the business's
 * organization, which every hire gets (ADR 0060).
 */
export async function cmoPayer(
  hire: Pick<Cuso, "workspaceId">,
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

/**
 * Cuso is found, not linked (ADR 0062): a shared Soko Bot of a Project on
 * CMO's version. Hiring Cuso makes at most one per Project.
 */
export const CUSO_BOT_WHERE = {
  versionId: CMO_SOKO_BOT_VERSION_ID,
  userId: null,
  projectId: { not: null },
} satisfies Prisma.SokoBotWhereInput;

/** A Cuso nobody deleted or archived: the one people work with. */
const LIVE_CUSO_WHERE = {
  ...CUSO_BOT_WHERE,
  deletedAt: null,
  archivedAt: null,
} satisfies Prisma.SokoBotWhereInput;

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
export type Cuso = {
  sokoBotId: string;
  projectId: string;
  createdAt: Date;
  workspaceId: string;
  websiteUrl: string;
  businessName: string;
  brandBrain: Prisma.JsonValue | null;
  brandBrainUpdatedAt: Date | null;
  brandBrainApprovedAt: Date | null;
};

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
    brandBrainApprovedAt: project.brandBrain?.confirmedAt ?? null,
  };
}

/**
 * The Cuso this person works with (ADR 0061): the live one in their preferred
 * organization, which hiring made preferred, else the newest live one of any
 * organization they belong to. A deleted or archived Cuso hired no one.
 */
export async function findCusoForUser(userId: string): Promise<Cuso | null> {
  const [user, bots] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { preferredOrganizationId: true },
    }),
    prisma.sokoBot.findMany({
      where: {
        ...LIVE_CUSO_WHERE,
        project: {
          workspace: { organization: { members: { some: { userId } } } },
        },
      },
      select: CUSO_SELECT,
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const found =
    bots.find(
      (bot) =>
        bot.project?.workspace.organizationId === user?.preferredOrganizationId,
    ) ?? bots[0];
  return found ? cusoView(found) : null;
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

/** What the founder reads when a step cannot start for lack of credits. */
export const CMO_OUT_OF_CREDITS = "You're out of credits";

/** A turn of Cuso's that `userId`, a member of his organization, started. */
export async function startCmoTurn(
  hire: Pick<Cuso, "workspaceId" | "sokoBotId">,
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

export const ONBOARDING_TURN_PREFIX = "cmo:onboarding:";
export const STRATEGY_TURN_PREFIX = "cmo:strategy:";

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
export async function settledTurnStatus(
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

export const TURN_ROW_SELECT = {
  id: true,
  status: true,
  eveSessionId: true,
  createdAt: true,
  clientTurnId: true,
} as const;

/**
 * The member Cuso's own runs act as (his rhythms, the month's production, the
 * brand capture): who hired him while they are still a member of the
 * business, else its longest-standing owner or admin, so a hirer who left
 * never stalls the business's month (ADR 0061). Null only for an organization
 * with neither.
 */
export async function cmoRunnerUserId(
  hire: Pick<Cuso, "workspaceId" | "sokoBotId">,
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

/** A write's target: the Cuso a member works with, or the bot itself. */
export async function requireCuso(
  where: { userId: string } | { sokoBotId: string },
  db: Prisma.TransactionClient = prisma,
): Promise<Cuso> {
  const cuso =
    "sokoBotId" in where
      ? await findCusoForBot(where.sokoBotId, db)
      : await findCusoForUser(where.userId);
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
