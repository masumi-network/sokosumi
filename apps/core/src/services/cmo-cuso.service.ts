import { type CmoHire, MemberRole, type Prisma } from "@sokosumi/database";
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
  hire: Pick<CmoHireView, "workspaceId">,
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
 * A CMO hire with what it reads off its Project, which keeps no copy: the
 * workspace (the business's organization, which pays), the website, and the
 * business name, the website's host.
 */
export type CmoHireView = CmoHire & {
  workspaceId: string;
  websiteUrl: string;
  businessName: string;
};

/** The Project fields a hire read includes, for `cmoHireView`. */
export const CMO_HIRE_PROJECT = {
  project: { select: { workspaceId: true, websiteUrl: true } },
} as const;

export function cmoHireView({
  project,
  ...hire
}: CmoHire & {
  project: { workspaceId: string; websiteUrl: string | null };
}): CmoHireView {
  const websiteUrl = project.websiteUrl ?? "";
  return {
    ...hire,
    workspaceId: project.workspaceId,
    websiteUrl,
    businessName: cmoBusinessNameFromUrl(websiteUrl),
  };
}

/**
 * The Cuso this person works with (ADR 0061): the live hire in their preferred
 * organization, which hiring made preferred, else the newest live hire of any
 * organization they belong to. A deleted or archived Cuso hired no one.
 */
export async function getCmoHireForUser(
  userId: string,
): Promise<CmoHireView | null> {
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
          select: {
            workspaceId: true,
            websiteUrl: true,
            workspace: { select: { organizationId: true } },
          },
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
  return found ? cmoHireView(found) : null;
}

export async function getCmoHireForBot(
  sokoBotId: string,
): Promise<CmoHireView | null> {
  const hire = await prisma.cmoHire.findUnique({
    where: { sokoBotId },
    include: CMO_HIRE_PROJECT,
  });
  return hire ? cmoHireView(hire) : null;
}

/** Paid and approved: Cuso makes the whole month now (cmo-production.service). */
export async function startCmoProduction(hireId: string): Promise<void> {
  const { kickCmoProduction } = await import(
    "@/services/cmo-production.service"
  );
  kickCmoProduction(hireId);
}

/** What the founder reads when a step cannot start for lack of credits. */
export const CMO_OUT_OF_CREDITS = "You're out of credits";

/** A turn of Cuso's that `userId`, a member of his organization, started. */
export async function startCmoTurn(
  hire: Pick<CmoHireView, "workspaceId" | "sokoBotId">,
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
  hire: Pick<CmoHireView, "workspaceId" | "sokoBotId">,
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
export async function cmoHireWhere(
  where: { userId: string } | { sokoBotId: string },
): Promise<Prisma.CmoHireWhereUniqueInput> {
  if ("sokoBotId" in where) return where;
  const hire = await getCmoHireForUser(where.userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  return { id: hire.id };
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
