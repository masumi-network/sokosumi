import { createHash } from "node:crypto";
import { getEnv } from "@/config/env";
import { isPrivateTaskVisibleToHuman } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import { SYSTEM_TURN_ROUTES } from "@/lib/soko-bot/system-routes";
import { roundCredits, taskCreditsCharged } from "@/lib/soko-bot/task-charges";
import { INVOLVING_DELEGATION } from "@/lib/soko-bot/task-involvement";
import {
  SokoBotBusyError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import { proactiveGate } from "@/services/soko-bot-proactive.service";

const BATCH_SIZE = 500;
const MAX_CHANGES_PER_TURN = 8;

/** Task statuses worth waking the bot for; intermediate churn stays silent. */
const TASK_WAKE_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "INPUT_REQUIRED",
  "APPROVAL_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "OUT_OF_CREDITS",
  "GRANT_PENDING",
]);
const JOB_WAKE_STATUSES = new Set(["COMPLETED", "FAILED", "AWAITING_INPUT"]);
const FINISHED = new Set(["COMPLETED", "FAILED", "CANCELED"]);

export interface SokoBotEventsSyncInput {
  abortSignal: AbortSignal;
  shouldContinue: () => boolean;
}

export interface SokoBotEventsSyncResult {
  scanned: number;
  woken: number;
  deferred: number;
  failed: number;
}

interface Change {
  delegationId: string;
  eventId?: string | null;
  eventAt?: Date;
  designatedHandlerBotId?: string | null;
  kind: "TASK" | "JOB";
  entityId: string;
  name: string;
  from: string | null;
  to: string;
  /** Latest event comment: the Coworker's question, result, or failure reason. */
  note: string | null;
  /** Credits charged on the Task so far, set once it has finished. */
  creditsCharged?: number;
}

interface BotWork {
  sokoBotId: string;
  userId: string;
  workspaceId: string;
  changes: Change[];
  /** Delegations whose baseline is set silently (first observation). */
  baselines: {
    delegationId: string;
    status: string;
    eventId?: string | null;
    eventAt?: Date;
  }[];
}

export function sokoBotEventClientTurnId(changes: Change[]): string {
  const occurrences = changes
    .map((c) => [c.kind, c.entityId, c.eventId ?? c.to])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return `event:${createHash("sha256").update(JSON.stringify(occurrences)).digest("hex")}`;
}

export function buildEventMessage(changes: Change[]): string {
  const lines = changes.map((change) => {
    const label = change.kind === "TASK" ? "Task" : "Job";
    const from = change.from ? ` (was ${change.from})` : "";
    const note = change.note
      ? `\n  Latest comment: ${change.note.replace(/\s+/g, " ").trim().slice(0, 600)}`
      : "";
    const charged =
      change.creditsCharged !== undefined
        ? ` Charged ${change.creditsCharged} credits.`
        : "";
    return `- ${label} "${change.name}" (id ${change.entityId}) is now ${change.to}${from}.${charged}${note}`;
  });
  return [
    "Delegated work changed status:",
    ...lines,
    "",
    "Read each Task with get_task_status. INPUT_REQUIRED: answer the Coworker with reply_to_task (status READY) when the answer is in the task, project, or memory; otherwise ask the owner one question. FAILED: decide between reply_to_task READY with guidance, a new linked Task, or reporting. COMPLETED: check the result and create linked follow-up Tasks when the request called for them. Compare the credits charged with what the owner approved and say plainly if it went over. Update memory and any related schedule, then report briefly.",
  ].join("\n");
}

/**
 * Wakes a Soko Bot when Tasks or Jobs it delegated reach a status that
 * needs attention. Polls delegations instead of hooking every mutation
 * path: one place, idempotent, and a busy bot simply gets the change on
 * the next tick. Runs from the same cron as the other Soko Bot syncs.
 */
export class SokoBotEventsSyncService {
  async syncDelegatedWork(
    input: SokoBotEventsSyncInput,
  ): Promise<SokoBotEventsSyncResult> {
    const result: SokoBotEventsSyncResult = {
      scanned: 0,
      woken: 0,
      deferred: 0,
      failed: 0,
    };
    if (!getEnv().SOKO_BOT_ENABLED) return result;
    // Platform kill switch covers everything bots start on their own, and a
    // taskboard event turn is exactly that.
    if (getEnv().SOKO_BOT_PROACTIVE_PAUSED) return result;

    const scan = await prisma.syncMetadata.upsert({
      where: { key: "soko-events-v2" },
      create: { key: "soko-events-v2", lastSyncedAt: new Date() },
      update: {},
    });
    const readPage = (cursor?: string | null) =>
      prisma.sokoBotDelegation.findMany({
        where: {
          ...(cursor ? { id: { gt: cursor } } : {}),
          OR: [{ taskId: { not: null } }, { jobId: { not: null } }],
          ...INVOLVING_DELEGATION,
          // Unattended work the bot starts itself honours the owner's pause,
          // not just the administrator's.
          turn: {
            sokoBot: {
              archivedAt: null,
              adminPausedAt: null,
              proactivePaused: false,
            },
          },
        },
        // Stable keyset rotation visits old unresolved work without rescanning
        // the whole table or starving it behind newer delegations.
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        select: {
          id: true,
          kind: true,
          lastSeenStatus: true,
          lastSeenEventId: true,
          lastSeenEventAt: true,
          task: {
            select: {
              id: true,
              name: true,
              status: true,
              visibility: true,
              ownerId: true,
              workspaceId: true,
              archivedAt: true,
              assigneeSokoBotId: true,
              events: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
                select: { id: true, comment: true, createdAt: true },
              },
            },
          },
          job: {
            select: {
              id: true,
              name: true,
              ownerId: true,
              workspaceId: true,
              task: { select: { visibility: true, ownerId: true } },
              events: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
                select: { id: true, status: true, createdAt: true },
              },
            },
          },
          turn: {
            select: { sokoBotId: true, userId: true, workspaceId: true },
          },
        },
      });
    const delegations = await readPage(scan.cursorId);
    result.scanned = delegations.length;

    const byBot = new Map<string, BotWork>();
    for (const delegation of delegations) {
      if (!input.shouldContinue() || input.abortSignal.aborted) break;
      if (
        delegation.task &&
        (delegation.task.archivedAt ||
          delegation.task.workspaceId !== delegation.turn.workspaceId ||
          !isPrivateTaskVisibleToHuman(delegation.task, delegation.turn.userId))
      )
        continue;
      if (
        delegation.job &&
        (delegation.job.workspaceId !== delegation.turn.workspaceId ||
          delegation.job.ownerId !== delegation.turn.userId ||
          (delegation.job.task &&
            !isPrivateTaskVisibleToHuman(
              delegation.job.task,
              delegation.turn.userId,
            )))
      )
        continue;
      const current = delegation.task
        ? {
            id: delegation.task.id,
            name: delegation.task.name,
            status: delegation.task.status,
            note: delegation.task.events[0]?.comment ?? null,
            eventId: delegation.task.events[0]?.id ?? null,
            eventAt: delegation.task.events[0]?.createdAt,
          }
        : delegation.job
          ? {
              id: delegation.job.id,
              name: delegation.job.name ?? "Agent job",
              status: delegation.job.events[0]?.status ?? null,
              note: null,
              eventId: delegation.job.events[0]?.id ?? null,
              eventAt: delegation.job.events[0]?.createdAt,
            }
          : null;
      if (
        !current?.status ||
        (current.status === delegation.lastSeenStatus &&
          (!current.eventId || current.eventId === delegation.lastSeenEventId))
      ) {
        continue;
      }
      const work = byBot.get(delegation.turn.sokoBotId) ?? {
        sokoBotId: delegation.turn.sokoBotId,
        userId: delegation.turn.userId,
        workspaceId: delegation.turn.workspaceId,
        changes: [],
        baselines: [],
      };
      byBot.set(delegation.turn.sokoBotId, work);
      if (
        (!delegation.lastSeenEventAt &&
          delegation.lastSeenStatus === null &&
          !current.eventAt) ||
        (current.eventAt && current.eventAt < scan.createdAt)
      ) {
        work.baselines.push({
          delegationId: delegation.id,
          status: current.status,
          eventId: current.eventId,
          eventAt: current.eventAt ?? scan.createdAt,
        });
        continue;
      }
      if (delegation.lastSeenEventAt) {
        const cursorAt = new Date(
          Math.max(
            delegation.lastSeenEventAt.getTime(),
            scan.createdAt.getTime(),
          ),
        );
        const cursor = {
          OR: [
            { createdAt: { gt: cursorAt } },
            {
              createdAt: cursorAt,
              id: {
                gt:
                  cursorAt.getTime() === delegation.lastSeenEventAt.getTime()
                    ? (delegation.lastSeenEventId ?? "")
                    : "",
              },
            },
          ],
        };
        const events = delegation.task
          ? await prisma.taskEvent.findMany({
              where: { taskId: current.id, ...cursor },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              take: MAX_CHANGES_PER_TURN,
              select: {
                id: true,
                createdAt: true,
                status: true,
                comment: true,
              },
            })
          : (
              await prisma.jobEvent.findMany({
                where: { jobId: current.id, ...cursor },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                take: MAX_CHANGES_PER_TURN,
                select: { id: true, createdAt: true, status: true },
              })
            ).map((event) => ({ ...event, comment: null }));
        const actionable = events.filter(
          (event) =>
            event.status &&
            (delegation.task ? TASK_WAKE_STATUSES : JOB_WAKE_STATUSES).has(
              event.status,
            ),
        );
        for (const event of actionable) {
          work.changes.push({
            delegationId: delegation.id,
            eventId: event.id,
            eventAt: event.createdAt,
            designatedHandlerBotId: delegation.task
              ? (delegation.task.assigneeSokoBotId ??
                (delegation.task.ownerId === delegation.turn.userId
                  ? delegation.turn.sokoBotId
                  : null))
              : delegation.turn.sokoBotId,
            kind: delegation.task ? "TASK" : "JOB",
            entityId: current.id,
            name: current.name,
            from: delegation.lastSeenStatus,
            to: event.status ?? current.status,
            note: event.comment,
          });
        }
        if (!actionable.length && events.length) {
          const last = events[events.length - 1];
          work.baselines.push({
            delegationId: delegation.id,
            status: last.status ?? current.status,
            eventId: last.id,
            eventAt: last.createdAt,
          });
        }
        continue;
      }
      const wake = delegation.task
        ? TASK_WAKE_STATUSES.has(current.status)
        : JOB_WAKE_STATUSES.has(current.status);
      if (
        (delegation.lastSeenStatus === null &&
          (current.status === "COMPLETED" || current.status === "CANCELED")) ||
        !wake
      ) {
        work.baselines.push({
          delegationId: delegation.id,
          status: current.status,
          eventId: current.eventId,
          eventAt: current.eventAt,
        });
        continue;
      }
      work.changes.push({
        delegationId: delegation.id,
        eventId: current.eventId,
        eventAt: current.eventAt,
        designatedHandlerBotId: delegation.task
          ? (delegation.task.assigneeSokoBotId ??
            (delegation.task.ownerId === delegation.turn.userId
              ? delegation.turn.sokoBotId
              : null))
          : delegation.turn.sokoBotId,
        kind: delegation.task ? "TASK" : "JOB",
        entityId: current.id,
        name: current.name,
        from: delegation.lastSeenStatus,
        to: current.status,
        note: current.note ?? null,
      });
    }

    for (const work of byBot.values()) {
      if (!input.shouldContinue()) break;
      if (work.baselines.length > 0) {
        await this.markSeen(work.baselines);
      }
      if (work.changes.length === 0) continue;
      // EVENT turns are self-started and bill the owner, so they answer to the
      // owner's pause and daily cap like every other turn the bot begins. A
      // bot that comments on its own Task produces an event that would
      // otherwise wake it again, every minute, without a ceiling.
      const gate = await proactiveGate(work.sokoBotId);
      if (!gate.ok) {
        // Logged rather than skipped in silence: a bot that stops reacting to
        // its Coworkers looks identical to a broken sync from the outside,
        // and this is the line that tells the two apart.
        console.info("[soko-bot-events] Wake withheld", {
          sokoBotId: work.sokoBotId,
          reason: gate.reason,
          usedToday: gate.usedToday,
          limit: gate.limit,
          changes: work.changes.length,
        });
        // One deferral, matching the busy-bot case below: the counter is bots
        // whose wake did not happen, not changes.
        result.deferred += 1;
        continue;
      }
      const consumed = await prisma.sokoBotEventInbox.findMany({
        where: {
          botId: work.sokoBotId,
          eventId: {
            in: work.changes.flatMap((change) =>
              change.eventId ? [change.eventId] : [],
            ),
          },
        },
        select: { eventId: true },
      });
      const consumedIds = new Set(consumed.map((item) => item.eventId));
      // Advance only a consumed prefix for each delegation. A later event
      // consumed by taskboard must not skip an earlier pending occurrence.
      const blockedDelegations = new Set<string>();
      const consumedPrefix: BotWork["baselines"] = [];
      for (const change of work.changes) {
        if (!change.eventId || !consumedIds.has(change.eventId)) {
          blockedDelegations.add(change.delegationId);
        } else if (!blockedDelegations.has(change.delegationId)) {
          consumedPrefix.push({
            delegationId: change.delegationId,
            status: change.to,
            eventId: change.eventId,
            eventAt: change.eventAt,
          });
        }
      }
      await this.markSeen(consumedPrefix);
      work.changes = work.changes.filter(
        (change) => !change.eventId || !consumedIds.has(change.eventId),
      );
      if (!work.changes.length) continue;
      // Collapse duplicate delegations, preserving distinct event occurrences.
      const unique = new Map<string, Change>();
      for (const change of work.changes)
        unique.set(`${change.entityId}:${change.eventId ?? change.to}`, change);
      const changes = Array.from(unique.values())
        .sort(
          (a, b) =>
            (a.eventAt?.getTime() ?? 0) - (b.eventAt?.getTime() ?? 0) ||
            (a.eventId ?? "").localeCompare(b.eventId ?? ""),
        )
        .slice(0, MAX_CHANGES_PER_TURN);
      const charged = await taskCreditsCharged(
        changes
          .filter((change) => change.kind === "TASK" && FINISHED.has(change.to))
          .map((change) => change.entityId),
      );
      for (const change of changes)
        if (change.kind === "TASK" && FINISHED.has(change.to))
          change.creditsCharged = roundCredits(
            charged.get(change.entityId) ?? 0,
          );
      try {
        const started = await sokoBotControlPlane.startTurn({
          userId: work.userId,
          workspaceId: work.workspaceId,
          sokoBotId: work.sokoBotId,
          clientTurnId: sokoBotEventClientTurnId(changes),
          message: buildEventMessage(changes),
          source: "EVENT",
          presetRoute: SYSTEM_TURN_ROUTES.events,
          eventBatch: changes.map((change) => ({
            eventId: change.eventId ?? `${change.entityId}:${change.to}`,
            entityId: change.entityId,
            purpose: `${change.kind}_EVENT`,
            status: change.to,
            designatedHandlerBotId:
              change.designatedHandlerBotId === undefined
                ? work.sokoBotId
                : change.designatedHandlerBotId,
            delegationEventAt: change.eventAt,
            delegationIds: work.changes
              .filter((item) => item.entityId === change.entityId)
              .map((item) => item.delegationId),
          })),
        });
        result.woken += 1;
        if (
          started.reconciliationLeaseToken &&
          (started.status === "STARTING" || started.status === "RUNNING")
        ) {
          await sokoBotControlPlane
            .reconcileTurn(
              started.turnId,
              input.abortSignal,
              started.reconciliationLeaseToken,
            )
            .catch((error) => {
              console.error("Soko Bot event turn reconciliation failed", {
                turnId: started.turnId,
                error: error instanceof Error ? error.message : "unknown",
              });
            });
        }
      } catch (error) {
        if (error instanceof SokoBotBusyError) {
          // The bot is mid-turn; the drift stays unseen and retries next tick.
          result.deferred += 1;
          continue;
        }
        result.failed += 1;
        console.error("Soko Bot event wake-up failed", {
          sokoBotId: work.sokoBotId,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    if (input.shouldContinue() && !input.abortSignal.aborted) {
      await prisma.syncMetadata.update({
        where: { key: scan.key },
        data: {
          cursorId:
            delegations.length === BATCH_SIZE ? delegations.at(-1)?.id : null,
          lastSyncedAt: new Date(),
        },
      });
    }
    return result;
  }

  private async markSeen(
    items: {
      delegationId: string;
      status: string;
      eventId?: string | null;
      eventAt?: Date;
    }[],
  ) {
    // Sequential writes preserve cursor order when a page contains several
    // occurrences for the same delegation.
    for (const item of items) {
      await prisma.sokoBotDelegation.update({
        where: { id: item.delegationId },
        data: {
          lastSeenStatus: item.status,
          lastSeenEventId: item.eventId ?? null,
          lastSeenEventAt: item.eventAt,
        },
      });
    }
  }
}

export const sokoBotEventsSyncService = new SokoBotEventsSyncService();
