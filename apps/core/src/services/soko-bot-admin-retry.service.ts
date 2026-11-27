import type { Prisma, SokoBot, SokoBotTurn } from "@sokosumi/database";
import {
  isSokoBotSandboxCapability,
  parseOwnerAuthority,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { DETACHED_SOKO_BOT_NETWORK } from "@/lib/network";
import {
  sokoBotActingUserId,
  sokoBotScheduleActingUserId,
} from "@/lib/soko-bot/acting-user";
import {
  capabilitiesForWatchFollowUp,
  isScheduleAuthorityRevoked,
  isWatchClientTurnId,
  type OwnerAuthorityAskedByKind,
  resolveSocialWriteOrigin,
} from "@/lib/soko-bot/owner-authority";
import {
  failedTurnRoute,
  isStoredMeetingPrep,
  SYSTEM_TURN_ROUTES,
  scheduleAuthorityRoute,
  storedMeetingPrepKind,
  storedMeetingRetrySlot,
  systemScheduleRoute,
} from "@/lib/soko-bot/system-routes";
import type { StartSokoBotTurnInput } from "@/lib/soko-bot/turn-start";
import {
  SokoBotRetryableStartError,
  SokoBotValidationError,
} from "@/services/soko-bot-control-plane.service";
import { buildScheduledSystemBeat } from "@/services/soko-bot-scheduled-beat.service";

const ORIGIN_UNAVAILABLE =
  "Cannot recover the original occurrence for this retry";
const ORIGIN_TURN = {
  id: true,
  source: true,
  clientTurnId: true,
  classifierVersion: true,
  classification: true,
} as const satisfies Prisma.SokoBotTurnSelect;
type OriginTurn = Prisma.SokoBotTurnGetPayload<{ select: typeof ORIGIN_TURN }>;
type DurableRetry = Pick<
  SokoBotTurn,
  "source" | "classifierVersion" | "classification" | "userMessage"
>;

export function loadAdminScheduleRun(sokoBotId: string, runId: string) {
  return prisma.sokoBotScheduleRun.findFirst({
    where: { id: runId, schedule: { sokoBotId } },
    include: {
      schedule: true,
      turn: { select: { ...ORIGIN_TURN, userMessage: true, status: true } },
    },
  });
}

async function meetingSlotForFailedTurn(
  sokoBotId: string,
  failed: OriginTurn,
): Promise<Date | null> {
  let turn = failed;
  const seen = new Set<string>();
  while (turn.source === "ADMIN_RETRY") {
    const slot = storedMeetingRetrySlot(turn);
    if (slot) return slot;
    if (seen.has(turn.id)) throw new SokoBotValidationError(ORIGIN_UNAVAILABLE);
    seen.add(turn.id);
    // Only Core writes these IDs on admin turns. A person's CHAT clientTurnId
    // and the text of any stored prompt have no authority over the retry.
    const [kind, target] = turn.clientTurnId.split(":");
    if (kind === "admin-schedule-retry" && target) {
      const run = await prisma.sokoBotScheduleRun.findFirst({
        where: { id: target, schedule: { sokoBotId } },
        select: {
          scheduledFor: true,
          schedule: { select: { systemKey: true } },
        },
      });
      if (!run) throw new SokoBotValidationError(ORIGIN_UNAVAILABLE);
      return run.schedule.systemKey === "meeting-prep"
        ? run.scheduledFor
        : null;
    }
    if (kind !== "admin-retry" || !target)
      throw new SokoBotValidationError(ORIGIN_UNAVAILABLE);
    const parent = await prisma.sokoBotTurn.findFirst({
      where: { id: target, sokoBotId },
      select: ORIGIN_TURN,
    });
    if (!parent) throw new SokoBotValidationError(ORIGIN_UNAVAILABLE);
    turn = parent;
  }
  if (turn.source !== "SCHEDULE") return null;
  const match = /^schedule:([^:]+):(.+)$/.exec(turn.clientTurnId);
  const time = match && new Date(match[2]);
  const occurrence =
    match &&
    time &&
    Number.isFinite(time.getTime()) &&
    time.toISOString() === match[2]
      ? { scheduleId: match[1], scheduledFor: time }
      : null;
  const run = await prisma.sokoBotScheduleRun.findFirst({
    where: { ...(occurrence ?? { turnId: turn.id }), schedule: { sokoBotId } },
    select: { scheduledFor: true, schedule: { select: { systemKey: true } } },
  });
  if (run)
    return run.schedule.systemKey === "meeting-prep" ? run.scheduledFor : null;
  if (isStoredMeetingPrep(turn)) {
    if (occurrence) return occurrence.scheduledFor;
    throw new SokoBotValidationError(ORIGIN_UNAVAILABLE);
  }
  if (occurrence) {
    // Retention can prune an old run. The original schedule still identifies
    // its kind, even when an operator rebound the occurrence to a newer turn.
    const schedule = await prisma.sokoBotSchedule.findFirst({
      where: { id: occurrence.scheduleId, sokoBotId },
      select: { systemKey: true },
    });
    if (!schedule) throw new SokoBotValidationError(ORIGIN_UNAVAILABLE);
    if (schedule.systemKey === "meeting-prep") return occurrence.scheduledFor;
  }
  return null;
}

const REBUILD_MEETING =
  "Start a new retry to rebuild meeting evidence for the original occurrence.";

/** Old retries can still hold the original packet and a generic route. */
export async function meetingReplayRefusal(
  turn: OriginTurn & { sokoBotId: string },
): Promise<string | null> {
  if (turn.source === "SCHEDULE")
    return storedMeetingPrepKind(turn) === "legacy" ? REBUILD_MEETING : null;
  if (turn.source !== "ADMIN_RETRY" || storedMeetingRetrySlot(turn))
    return null;
  try {
    return (await meetingSlotForFailedTurn(turn.sokoBotId, turn))
      ? REBUILD_MEETING
      : null;
  } catch (error) {
    if (error instanceof SokoBotValidationError) return error.message;
    throw new SokoBotRetryableStartError(
      "Could not verify the original occurrence for this retry",
      { cause: error },
    );
  }
}

export async function scheduleRetryInput(
  bot: SokoBot,
  run: NonNullable<Awaited<ReturnType<typeof loadAdminScheduleRun>>>,
  boundTurnId: string | null,
) {
  if (run.schedule.systemKey === "meeting-prep")
    return meetingRetryInput(
      bot,
      run.scheduledFor,
      boundTurnId ? run.turn : null,
    );
  const systemRoute = systemScheduleRoute(run.schedule.systemKey);
  const hasPersistedAuthority =
    run.schedule.authority !== null && run.schedule.authority !== undefined;
  const revoked =
    !systemRoute && hasPersistedAuthority
      ? await isScheduleAuthorityRevoked(run.schedule)
      : false;
  const presetRoute =
    systemRoute ??
    (hasPersistedAuthority
      ? scheduleAuthorityRoute({
          id: run.schedule.id,
          sokoBotId: run.schedule.sokoBotId,
          workspaceId: run.schedule.workspaceId,
          capabilityNames: run.schedule.capabilityNames ?? [],
          authority: run.schedule.authority,
          actingUserId: sokoBotScheduleActingUserId({
            requestedByUserId: run.schedule.requestedByUserId,
            systemKey: run.schedule.systemKey,
            sokoBot: bot,
          }),
          botUserId: bot.userId,
          botProjectId: bot.projectId ?? null,
          botVersionId: bot.versionId ?? null,
          ...(revoked ? { revoked: true } : {}),
        })
      : undefined);
  return {
    message: run.prompt ?? run.schedule.prompt,
    presetRoute,
  };
}

async function meetingRetryInput(
  bot: SokoBot,
  slot: Date,
  durable?: DurableRetry | null,
) {
  if (!(slot instanceof Date) || !Number.isFinite(slot.getTime()))
    throw new SokoBotValidationError(ORIGIN_UNAVAILABLE);
  const presetRoute = {
    ...SYSTEM_TURN_ROUTES["meeting-prep"],
    meetingPrepSlot: slot.toISOString(),
  };
  if (durable) {
    if (storedMeetingRetrySlot(durable)?.getTime() !== slot.getTime())
      throw new SokoBotValidationError(
        "This retry already reserved an earlier brief. Start a new retry to rebuild its meeting evidence.",
      );
    return { presetRoute, message: durable.userMessage };
  }
  const beat = await buildScheduledSystemBeat(bot, "meeting-prep", slot, "");
  if (beat.skip)
    throw new SokoBotValidationError(
      "No meeting evidence for the original occurrence",
    );
  return { presetRoute, message: beat.message };
}

export async function failedRetryInput(
  bot: SokoBot,
  failed: SokoBotTurn,
  clientTurnId: string,
): Promise<StartSokoBotTurnInput> {
  const durable =
    failed.source === "SCHEDULE" || failed.source === "ADMIN_RETRY"
      ? await prisma.sokoBotTurn.findUnique({
          where: {
            sokoBotId_clientTurnId: { sokoBotId: bot.id, clientTurnId },
          },
          select: {
            source: true,
            classification: true,
            classifierVersion: true,
            userMessage: true,
          },
        })
      : null;
  const slot =
    (durable && storedMeetingRetrySlot(durable)) ??
    (await meetingSlotForFailedTurn(bot.id, failed));
  const actingUserId = sokoBotActingUserId({
    requestedByUserId: failed.requestedByUserId,
    sokoBot: bot,
  });
  let presetRoute = slot ? undefined : failedTurnRoute(failed);
  if (
    !slot &&
    (failed.source === "SCHEDULE" ||
      failed.source === "ADMIN_RETRY" ||
      isWatchClientTurnId(failed.clientTurnId))
  ) {
    const origin = await resolveSocialWriteOrigin(failed);
    if (origin.watchAuthority && origin.watchAuthority.kind !== "none") {
      const persisted =
        origin.watchAuthority.kind === "watch"
          ? parseOwnerAuthority(origin.watchAuthority.authority)
          : null;
      if (origin.watchAuthority.kind !== "watch" || !persisted) {
        presetRoute = {
          route: failed.route ?? "DELEGATE_TASK",
          writeScope: presetRoute?.writeScope,
          reason:
            "Watch retry restricted: persisted owner authority unavailable or invalid.",
          capabilities: [],
          sandbox: false,
        };
      } else {
        const sharedBot = bot.userId === null;
        const askedByKind: OwnerAuthorityAskedByKind =
          failed.chainDepth > 0
            ? "ASSISTANT"
            : sharedBot
              ? "TEAMMATE"
              : actingUserId !== null && actingUserId === bot.userId
                ? "OWNER"
                : "TEAMMATE";
        const liveProjectId =
          origin.watchAuthority.watchProjectId ??
          bot.projectId ??
          origin.watchAuthority.botProjectId ??
          null;
        const capabilities = capabilitiesForWatchFollowUp(
          origin.watchAuthority.watchKind,
          failed.capabilityNames,
          {
            authority: persisted,
            live: {
              sokoBotId: bot.id,
              workspaceId: failed.workspaceId,
              versionId: bot.versionId ?? null,
              actingUserId,
              askedByKind,
              sharedBot,
              source: origin.source === "CHAT" ? "CHAT" : "SCHEDULE",
              ...(persisted.scheduleId
                ? { scheduleId: persisted.scheduleId }
                : {}),
              ...(liveProjectId
                ? {
                    targetScope: {
                      kind: "project" as const,
                      projectId: liveProjectId,
                    },
                  }
                : {}),
              hasWorkspaceAccess: true,
              botAlive: true,
              ...(origin.watchAuthority.revoked ? { revoked: true } : {}),
            },
          },
        );
        presetRoute = {
          route: failed.route ?? "DELEGATE_TASK",
          writeScope: presetRoute?.writeScope,
          reason: origin.watchAuthority.revoked
            ? "Watch retry restricted: owner authorization was revoked."
            : "Watch retry, intersected with its persisted owner authority.",
          capabilities,
          sandbox: capabilities.some(isSokoBotSandboxCapability),
        };
      }
    } else if (
      origin.source === "SCHEDULE" &&
      origin.scheduleAuthority.kind === "schedule"
    ) {
      const intersected = scheduleAuthorityRoute({
        id: origin.scheduleAuthority.scheduleId,
        sokoBotId: bot.id,
        workspaceId: failed.workspaceId,
        capabilityNames: failed.capabilityNames,
        authority: origin.scheduleAuthority.authority,
        actingUserId,
        botUserId: bot.userId,
        botProjectId: bot.projectId ?? null,
        botVersionId: bot.versionId ?? null,
        ...(origin.scheduleAuthority.revoked ? { revoked: true } : {}),
      });
      presetRoute = {
        route: failed.route ?? intersected.route,
        writeScope: presetRoute?.writeScope,
        reason: intersected.reason,
        capabilities: intersected.capabilities,
        sandbox: intersected.sandbox,
      };
    }
  }
  const input = slot
    ? await meetingRetryInput(bot, slot, durable)
    : { message: failed.userMessage, presetRoute };
  return {
    network: DETACHED_SOKO_BOT_NETWORK,
    // A replay acts only for the person the failed turn acted for.
    userId: actingUserId,
    sokoBotId: bot.id,
    workspaceId: failed.workspaceId,
    source: "ADMIN_RETRY",
    clientTurnId,
    ...input,
    // A retry replays untrusted text, so it must not replay it with a
    // wider grant than the turn that failed. Dropping these turned a
    // failed depth-1 turn another assistant asked for — read-only, and
    // its message written by that assistant — into an owner-audience
    // turn holding the whole route ceiling.
    ...(failed.chainDepth > 0 ||
    (failed.askedByUserId && failed.askedByUserId !== failed.requestedByUserId)
      ? {
          chat: {
            mentionId: failed.chatMentionId ?? "",
            responseMessageId: failed.chatResponseMessageId ?? "",
            askedByUserId: failed.askedByUserId,
            askedByBot: failed.chainDepth > 0,
            chainDepth: failed.chainDepth,
          },
        }
      : {}),
  };
}
