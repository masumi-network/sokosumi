import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import {
  SokoBotBusyError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";

const BATCH_SIZE = 500;
const WATCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
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
  kind: "TASK" | "JOB";
  entityId: string;
  name: string;
  from: string | null;
  to: string;
  /** Latest event comment: the Coworker's question, result, or failure reason. */
  note: string | null;
}

interface BotWork {
  sokoBotId: string;
  userId: string;
  workspaceId: string;
  changes: Change[];
  /** Delegations whose baseline is set silently (first observation). */
  baselines: { delegationId: string; status: string }[];
}

export function sokoBotEventClientTurnId(changes: Change[]): string {
  return `event:${changes.map((c) => `${c.delegationId}:${c.to}`).join(",")}`.slice(
    0,
    120,
  );
}

export function buildEventMessage(changes: Change[]): string {
  const lines = changes.map((change) => {
    const label = change.kind === "TASK" ? "Task" : "Job";
    const from = change.from ? ` (was ${change.from})` : "";
    const note = change.note
      ? `\n  Latest comment: ${change.note.replace(/\s+/g, " ").trim().slice(0, 600)}`
      : "";
    return `- ${label} "${change.name}" (id ${change.entityId}) is now ${change.to}${from}.${note}`;
  });
  return [
    "Delegated work changed status:",
    ...lines,
    "",
    "Read each Task with get_task_status. INPUT_REQUIRED: answer the Coworker with reply_to_task (status READY) when the answer is in the task, project, or memory; otherwise ask the owner one question. FAILED: decide between reply_to_task READY with guidance, a new linked Task, or reporting. COMPLETED: check the result and create linked follow-up Tasks when the request called for them. Update memory and any related schedule, then report briefly.",
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

    const delegations = await prisma.sokoBotDelegation.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - WATCH_WINDOW_MS) },
        OR: [{ taskId: { not: null } }, { jobId: { not: null } }],
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
      // Newest first: the delegations most likely to change are recent ones,
      // and a large backlog must not starve them.
      orderBy: { createdAt: "desc" },
      take: BATCH_SIZE,
      select: {
        id: true,
        kind: true,
        lastSeenStatus: true,
        task: {
          select: {
            id: true,
            name: true,
            status: true,
            events: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { comment: true },
            },
          },
        },
        job: {
          select: {
            id: true,
            name: true,
            events: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { status: true },
            },
          },
        },
        turn: {
          select: { sokoBotId: true, userId: true, workspaceId: true },
        },
      },
    });
    result.scanned = delegations.length;

    const byBot = new Map<string, BotWork>();
    for (const delegation of delegations) {
      const current = delegation.task
        ? {
            id: delegation.task.id,
            name: delegation.task.name,
            status: delegation.task.status,
          }
        : delegation.job
          ? {
              id: delegation.job.id,
              name: delegation.job.name ?? "Agent job",
              status: delegation.job.events[0]?.status ?? null,
              note: null,
            }
          : null;
      if (!current?.status || current.status === delegation.lastSeenStatus) {
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
      const wake = delegation.task
        ? TASK_WAKE_STATUSES.has(current.status)
        : JOB_WAKE_STATUSES.has(current.status);
      if (delegation.lastSeenStatus === null || !wake) {
        work.baselines.push({
          delegationId: delegation.id,
          status: current.status,
        });
        continue;
      }
      work.changes.push({
        delegationId: delegation.id,
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
      // Collapse one entity's multiple delegations into one change line.
      const unique = new Map<string, Change>();
      for (const change of work.changes) unique.set(change.entityId, change);
      const changes = Array.from(unique.values()).slice(
        0,
        MAX_CHANGES_PER_TURN,
      );
      try {
        const started = await sokoBotControlPlane.startTurn({
          userId: work.userId,
          workspaceId: work.workspaceId,
          clientTurnId: sokoBotEventClientTurnId(changes),
          message: buildEventMessage(changes),
          source: "EVENT",
        });
        await this.markSeen(
          work.changes.map((change) => ({
            delegationId: change.delegationId,
            status: change.to,
          })),
        );
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
    return result;
  }

  private async markSeen(items: { delegationId: string; status: string }[]) {
    await Promise.all(
      items.map((item) =>
        prisma.sokoBotDelegation.update({
          where: { id: item.delegationId },
          data: { lastSeenStatus: item.status },
        }),
      ),
    );
  }
}

export const sokoBotEventsSyncService = new SokoBotEventsSyncService();
