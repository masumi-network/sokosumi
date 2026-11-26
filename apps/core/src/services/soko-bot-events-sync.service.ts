import { createHash } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import {
  type SokoBotFollowUpAllows,
  sokoBotFollowUpAllowsSchema,
} from "@sokosumi/soko-bot";
import { createError } from "evlog";
import { getEnv } from "@/config/env";
import { isPrivateTaskVisibleToHuman } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import { createCoreLogger } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { sokoBotActingUserId } from "@/lib/soko-bot/acting-user";
import {
  JOB_WAKE_STATUSES,
  TASK_WAKE_STATUSES,
} from "@/lib/soko-bot/delegation-wake";
import { FOLLOW_UP_RETRY_SUFFIX } from "@/lib/soko-bot/follow-up-retry";
import {
  capabilitiesForDelegationFollowUp,
  intersectOwnerAuthority,
  resolveDelegationWakeAuthority,
} from "@/lib/soko-bot/owner-authority";
import { type OwnerRequestTurn } from "@/lib/soko-bot/owner-request";
import { reportSokoBotReconciliationLeaseLoss } from "@/lib/soko-bot/reconciliation-lease";
import {
  DELEGATION_EVENT_TURN_PREFIX,
  inheritedFollowUpRoute,
} from "@/lib/soko-bot/system-routes";
import { roundCredits, taskCreditsCharged } from "@/lib/soko-bot/task-charges";
import { INVOLVING_DELEGATION } from "@/lib/soko-bot/task-involvement";
import {
  SokoBotBusyError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import { proactiveGate } from "@/services/soko-bot-proactive.service";

const BATCH_SIZE = 500;
const MAX_CHANGES_PER_TURN = 8;

const FINISHED = new Set(["COMPLETED", "FAILED", "CANCELED"]);

/**
 * A Job's change is its Agent's event status; get_job_status reports the
 * Job's own status (`digestJob`), in other words.
 */
const JOB_READ_STATUSES: Record<string, readonly string[]> = {
  // A paid Job settles past its Agent's last word: a result waiting for
  // payment, a dispute, a refund.
  COMPLETED: [
    "completed",
    "result_pending",
    "dispute_pending",
    "dispute_resolved",
    "refund_pending",
    "refund_resolved",
  ],
  FAILED: [
    "failed",
    "payment_failed",
    "dispute_pending",
    "dispute_resolved",
    "refund_pending",
    "refund_resolved",
  ],
};

/**
 * What the read returned that shows it saw this change. A second input
 * request reads "input_required" like the first, so only its event id says
 * which one the read saw.
 */
function readSawChange(
  current: { status: string; eventId: string | null },
  delegation: { task: unknown },
): Prisma.SokoBotToolCallWhereInput {
  if (delegation.task)
    return { result: { path: ["status"], equals: current.status } };
  if (current.status === "AWAITING_INPUT")
    return {
      result: {
        path: ["inputRequest", "eventId"],
        equals: current.eventId ?? "",
      },
    };
  const statuses = JOB_READ_STATUSES[current.status] ?? [
    current.status.toLowerCase(),
  ];
  return {
    OR: statuses.map((status) => ({
      result: { path: ["status"], equals: status },
    })),
  };
}

/**
 * The scan's sync row. Its `createdAt` is the cutover: Task events older than
 * it are baselined, never woken. Whoever writes events before a first scan
 * (the owner benchmark) creates the row first.
 */
export const SOKO_EVENTS_SYNC_KEY = "soko-events-v2";

export interface SokoBotEventsSyncInput {
  abortSignal: AbortSignal;
  shouldContinue: () => boolean;
  /**
   * Scan only this bot's delegations, from the first, and leave the shared
   * cursor where it is. The owner benchmark wakes its fixture bot this way.
   */
  sokoBotId?: string;
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
  /** The plan the bot attached to this delegation, while it has not run. */
  followUp?: string | null;
  /** The owner's request's tools, when the owner asked for that plan. */
  ownerGranted?: readonly string[];
  /** The owner's own limits for the plan, when they gave any. */
  followUpAllows?: SokoBotFollowUpAllows | null;
  /** The failed turn this change hands the plan over from, on its one retry. */
  retryOfTurnId?: string;
}

/** A follow-up plan the bot attached to delegated work, as one wake reports it. */
export interface FollowUpPlan {
  kind: Change["kind"];
  entityId: string;
  name: string;
  status: string;
  plans: string[];
  delegationIds: string[];
  /** The work settled: this wake carries the plan out, and it never comes back. */
  due: boolean;
  /** The owner's own limits for these plans, when they gave any. */
  allows: SokoBotFollowUpAllows[];
}

/** The limits as stored; anything else stored there is no limit. */
export function storedAllows(value: unknown): SokoBotFollowUpAllows | null {
  return sokoBotFollowUpAllowsSchema.safeParse(value).data ?? null;
}

/** "at most 3 images and 50 credits", from the owner's limits. */
function allowsText(allows: readonly SokoBotFollowUpAllows[]): string | null {
  const parts = allows.flatMap((allow) => [
    ...(allow.images
      ? [`${allow.images} image${allow.images > 1 ? "s" : ""}`]
      : []),
    ...(allow.maxCredits ? [`${allow.maxCredits} credits on media`] : []),
  ]);
  return parts.length ? `at most ${parts.join(" and ")}` : null;
}

/**
 * A Task that FAILED can be restarted with reply_to_task, so its plan waits;
 * a Job that failed is over. Cancelled or finished work settles the plan.
 */
function settlesFollowUp(kind: Change["kind"], status: string): boolean {
  return kind === "TASK"
    ? status === "COMPLETED" || status === "CANCELED"
    : status === "COMPLETED" || status === "FAILED";
}

/** The plans pending on the entities `changes` report, from every delegation on them. */
export function followUpPlans(
  changes: readonly Change[],
  delegations: readonly Change[] = changes,
): FollowUpPlan[] {
  const byEntity = new Map<string, FollowUpPlan>();
  for (const change of changes) {
    const plan = byEntity.get(change.entityId) ?? {
      kind: change.kind,
      entityId: change.entityId,
      name: change.name,
      status: change.to,
      plans: [],
      delegationIds: [],
      due: false,
      allows: [],
    };
    plan.status = change.to;
    plan.due = settlesFollowUp(change.kind, change.to);
    byEntity.set(change.entityId, plan);
  }
  for (const delegation of delegations) {
    const plan = byEntity.get(delegation.entityId);
    if (
      !plan ||
      !delegation.followUp ||
      plan.delegationIds.includes(delegation.delegationId)
    )
      continue;
    plan.delegationIds.push(delegation.delegationId);
    if (!plan.plans.includes(delegation.followUp))
      plan.plans.push(delegation.followUp);
    if (delegation.followUpAllows) plan.allows.push(delegation.followUpAllows);
  }
  return Array.from(byEntity.values()).filter((plan) => plan.plans.length);
}

function followUpLine(plan: FollowUpPlan): string {
  const label = `${plan.kind === "TASK" ? "Task" : "Job"} "${plan.name}" (id ${plan.entityId})`;
  const planned = plan.plans.map((text) => `"${text}"`).join(" and ");
  const limits = allowsText(plan.allows);
  if (plan.status === "COMPLETED")
    return `- ${label} is COMPLETED. Your plan: ${planned}.${limits ? ` The owner allowed ${limits}; Core refuses more.` : ""} Do it now: read the full result with ${plan.kind === "TASK" ? "get_task_status" : "get_job_status"}, put its substance into what you hand on (not only a link or a one-line summary), and report what you did. Something the plan prepares for the owner (a post, an email) is made as a draft on the project and account the plan names, left for their approval: publishing, scheduling and sending wait for their OK. This plan will not be handed to you again.`;
  if (plan.due)
    return `- ${label} is ${plan.status}, so your plan ${planned} will not run. Tell the owner if it mattered; to try again, attach the plan as followUp to the new ${plan.kind === "TASK" ? "Task" : "hire"}.`;
  return `- ${label} is ${plan.status}. Your plan for when it completes: ${planned}. Not due yet: Core hands it back to you when the work completes, so do not create a schedule for it.`;
}

interface BotWork {
  sokoBotId: string;
  /** Who the turn acts for; null when a shared bot acts on its own. */
  userId: string | null;
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
  return `${DELEGATION_EVENT_TURN_PREFIX}${createHash("sha256").update(JSON.stringify(occurrences)).digest("hex")}`;
}

export function buildEventMessage(
  changes: Change[],
  plans: readonly FollowUpPlan[] = followUpPlans(changes),
): string {
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
    ...(plans.length
      ? [
          "Follow-up plans you attached to this work:",
          ...plans.map(followUpLine),
          "",
        ]
      : []),
    ...(changes.some((change) => change.kind === "TASK")
      ? [
          "Read each Task with get_task_status. INPUT_REQUIRED: answer the Coworker with reply_to_task (status READY) when the answer is in the task, project, or memory; otherwise ask the owner one question. FAILED: decide between reply_to_task READY with guidance, a new linked Task, or reporting. COMPLETED: check the result and create linked follow-up Tasks when the request called for them. Compare the credits charged with what the owner approved and say plainly if it went over.",
        ]
      : []),
    ...(changes.some((change) => change.kind === "JOB")
      ? [
          "Read each Job with get_job_status. AWAITING_INPUT: answer its inputRequest with provide_job_input when the answer is in the request, project, or memory; otherwise ask the owner one question. FAILED: say why and decide between hiring again with a better brief, another Agent, or reporting. COMPLETED: read the result and files, use them for any next step, and show the Job with preview_result.",
        ]
      : []),
    "Update memory and any related schedule, then report briefly.",
  ].join("\n");
}

/**
 * Whether the background run that delegated this work read its latest change
 * itself before it ended. A read counts when it finished after the change:
 * one that started a moment before still returned it.
 */
async function backgroundRunReadChange(
  runTurnId: string,
  current: {
    id: string;
    status: string;
    eventId: string | null;
    eventAt?: Date | null;
  },
  delegation: { task: unknown; job: unknown },
): Promise<boolean> {
  const field = delegation.task ? "taskId" : "jobId";
  const read = await prisma.sokoBotToolCall.findFirst({
    where: {
      turnId: runTurnId,
      capability: delegation.task ? "get_task_status" : "get_job_status",
      status: "COMPLETED",
      input: { path: [field], equals: current.id },
      // What the read returned decides, not when it ran: one that started
      // before the change and was saved after it still said RUNNING.
      ...readSawChange(current, delegation),
      ...(current.eventAt ? { updatedAt: { gte: current.eventAt } } : {}),
    },
    select: { id: true },
  });
  return read !== null;
}

function pendingFollowUp(delegation: {
  followUp: string | null;
  followUpTurnId: string | null;
}): string | null {
  return delegation.followUpTurnId ? null : delegation.followUp;
}

/**
 * Authoritative media limits for a delegation's wake prompt: prefers persisted
 * `OwnerAuthority.limits`, falling back to legacy `followUpAllows`.
 */
function delegationWakeAllows(delegation: {
  id: string;
  authority?: unknown;
  followUpAllows?: unknown;
  turn: OwnerRequestTurn & {
    id?: string;
    sokoBotId: string;
    workspaceId: string;
    versionId?: string | null;
    parentTurnId: string | null;
    parentTurn: OwnerRequestTurn | null;
    sokoBot?: { userId?: string | null } | null;
  };
}): SokoBotFollowUpAllows | null {
  const authority = resolveDelegationWakeAuthority(delegation, {
    sokoBotId: delegation.turn.sokoBotId,
    workspaceId: delegation.turn.workspaceId,
    versionId: delegation.turn.versionId ?? null,
  });
  if (authority.origin === "system") return null;
  if (authority.limits) {
    const mapped: SokoBotFollowUpAllows = {
      ...(authority.limits.images !== undefined
        ? { images: authority.limits.images }
        : {}),
      ...(authority.limits.maxMediaCredits !== undefined
        ? { maxCredits: authority.limits.maxMediaCredits }
        : {}),
    };
    return mapped.images !== undefined || mapped.maxCredits !== undefined
      ? mapped
      : null;
  }
  return storedAllows(delegation.followUpAllows);
}

/**
 * The tools of the turn that attached a follow-up, intersected through its
 * persisted `OwnerAuthority` (with deterministic fallback for pre-migration
 * rows where `authority === null`). Empty for expired, system, or non-owner
 * delegations.
 */
function ownerRequestGrant(delegation: {
  id: string;
  authority?: unknown;
  followUp: string | null;
  followUpAllows?: unknown;
  followUpTurnId: string | null;
  task?: { projectId?: string | null } | null;
  job?: { task?: { projectId?: string | null } | null } | null;
  turn: OwnerRequestTurn & {
    id?: string;
    sokoBotId: string;
    workspaceId: string;
    versionId?: string | null;
    parentTurnId: string | null;
    parentTurn: OwnerRequestTurn | null;
    capabilityNames: string[];
    sokoBot?: { userId?: string | null; projectId?: string | null } | null;
  };
}): readonly string[] {
  if (!pendingFollowUp(delegation)) return [];
  const authority = resolveDelegationWakeAuthority(delegation, {
    sokoBotId: delegation.turn.sokoBotId,
    workspaceId: delegation.turn.workspaceId,
    versionId: delegation.turn.versionId ?? null,
  });
  if (authority.origin === "system") return [];
  const actingUserId = sokoBotActingUserId({
    requestedByUserId: delegation.turn.requestedByUserId,
    sokoBot: { userId: delegation.turn.sokoBot?.userId ?? null },
  });
  const sharedBot = delegation.turn.sokoBot?.userId === null;
  const askedByKind =
    delegation.turn.chainDepth > 0
      ? ("ASSISTANT" as const)
      : sharedBot
        ? ("TEAMMATE" as const)
        : delegation.turn.askedByUserId !== null &&
            delegation.turn.askedByUserId !== delegation.turn.requestedByUserId
          ? ("TEAMMATE" as const)
          : ("OWNER" as const);
  const liveProjectId =
    delegation.task?.projectId ??
    delegation.job?.task?.projectId ??
    delegation.turn.sokoBot?.projectId ??
    null;
  const liveBase = {
    sokoBotId: delegation.turn.sokoBotId,
    workspaceId: delegation.turn.workspaceId,
    versionId: delegation.turn.versionId ?? null,
    actingUserId,
    askedByKind,
    sharedBot,
    source: "EVENT" as const,
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
  };
  const effective = intersectOwnerAuthority(authority, {
    ...liveBase,
    offeredCapabilities: [],
  });
  if (!effective.effective) return [];
  return capabilitiesForDelegationFollowUp(delegation.turn.capabilityNames, {
    authority: effective.authority,
    live: liveBase,
  });
}

/**
 * Turns a follow-up plan was handed to that FAILED and were not themselves
 * a retry: those plans get one more turn. A failed retry stays failed.
 */
async function failedFollowUpTurns(
  turnIds: readonly string[],
): Promise<Map<string, FailedFollowUpTurn>> {
  if (!turnIds.length) return new Map();
  const failed = await prisma.sokoBotTurn.findMany({
    where: { id: { in: [...new Set(turnIds)] }, status: "FAILED" },
    select: {
      id: true,
      eventInbox: { select: { eventId: true, entityId: true } },
    },
  });
  return new Map(
    failed.map((turn) => [
      turn.id,
      {
        retried: new Set(
          turn.eventInbox
            .filter((entry) => entry.eventId.endsWith(FOLLOW_UP_RETRY_SUFFIX))
            .map((entry) => entry.entityId),
        ),
      },
    ]),
  );
}

/**
 * A failed turn and the Tasks and Jobs whose plans it carried as a retry:
 * those are spent, while a first hand-over in the same turn still gets one.
 */
interface FailedFollowUpTurn {
  retried: ReadonlySet<string>;
}

const BACKGROUND_RUN_ACTIVE_STATUSES = new Set<string>([
  "QUEUED",
  "STARTING",
  "RUNNING",
  "CANCEL_REQUESTED",
]);

/**
 * Wakes a Soko Bot when Tasks or Jobs it delegated reach a status that
 * needs attention. Polls delegations instead of hooking every mutation
 * path: one place, idempotent, and a busy bot simply gets the change on
 * the next tick. Runs from the same cron as the other Soko Bot syncs.
 */
/** The events cron runs after its response, so its events stand alone. */
const OPERATION = "soko_bot_events_sync";

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
      where: { key: SOKO_EVENTS_SYNC_KEY },
      create: { key: SOKO_EVENTS_SYNC_KEY, lastSyncedAt: new Date() },
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
            ...(input.sokoBotId ? { sokoBotId: input.sokoBotId } : {}),
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
          turnId: true,
          kind: true,
          lastSeenStatus: true,
          lastSeenEventId: true,
          lastSeenEventAt: true,
          followUp: true,
          followUpAllows: true,
          authority: true,
          followUpTurnId: true,
          task: {
            select: {
              id: true,
              name: true,
              status: true,
              visibility: true,
              ownerId: true,
              workspaceId: true,
              projectId: true,
              archivedAt: true,
              assigneeSokoBotId: true,
              events: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
                select: {
                  id: true,
                  comment: true,
                  createdAt: true,
                  sokoBotId: true,
                },
              },
            },
          },
          job: {
            select: {
              id: true,
              name: true,
              ownerId: true,
              workspaceId: true,
              task: {
                select: { visibility: true, ownerId: true, projectId: true },
              },
              events: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
                select: { id: true, status: true, createdAt: true },
              },
            },
          },
          turn: {
            select: {
              id: true,
              sokoBotId: true,
              requestedByUserId: true,
              sokoBot: { select: { userId: true, projectId: true } },
              workspaceId: true,
              versionId: true,
              parentTurnId: true,
              status: true,
              source: true,
              chainDepth: true,
              askedByUserId: true,
              capabilityNames: true,
              parentTurn: {
                select: {
                  source: true,
                  chainDepth: true,
                  askedByUserId: true,
                  requestedByUserId: true,
                },
              },
            },
          },
        },
      });
    const delegations = await readPage(input.sokoBotId ? null : scan.cursorId);
    // A scoped scan has no cursor to resume from: it reads every page.
    if (input.sokoBotId) {
      let page = delegations;
      while (page.length === BATCH_SIZE) {
        page = await readPage(page.at(-1)?.id);
        delegations.push(...page);
      }
    }
    result.scanned = delegations.length;
    const retryableFollowUps = await failedFollowUpTurns(
      delegations.flatMap((delegation) =>
        delegation.followUp && delegation.followUpTurnId
          ? [delegation.followUpTurnId]
          : [],
      ),
    );

    const byBot = new Map<string, BotWork>();
    for (const delegation of delegations) {
      if (!input.shouldContinue() || input.abortSignal.aborted) break;
      if (
        delegation.task &&
        (delegation.task.archivedAt ||
          delegation.task.workspaceId !== delegation.turn.workspaceId ||
          !isPrivateTaskVisibleToHuman(
            delegation.task,
            sokoBotActingUserId(delegation.turn),
          ))
      )
        continue;
      if (
        delegation.job &&
        (delegation.job.workspaceId !== delegation.turn.workspaceId ||
          delegation.job.ownerId !== sokoBotActingUserId(delegation.turn) ||
          (delegation.job.task &&
            !isPrivateTaskVisibleToHuman(
              delegation.job.task,
              sokoBotActingUserId(delegation.turn),
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
            byThisBot:
              delegation.task.events[0]?.sokoBotId ===
              delegation.turn.sokoBotId,
          }
        : delegation.job
          ? {
              id: delegation.job.id,
              name: delegation.job.name ?? "Agent job",
              status: delegation.job.events[0]?.status ?? null,
              note: null,
              eventId: delegation.job.events[0]?.id ?? null,
              eventAt: delegation.job.events[0]?.createdAt,
              byThisBot: false,
            }
          : null;
      if (!current?.status) continue;
      // The turn the plan was handed to failed before carrying it out: the
      // change is already seen, so one more wake carries the plan, once.
      const failedFollowUp =
        delegation.followUp && delegation.followUpTurnId
          ? retryableFollowUps.get(delegation.followUpTurnId)
          : undefined;
      if (
        failedFollowUp &&
        !failedFollowUp.retried.has(current.id) &&
        delegation.followUpTurnId
      ) {
        const retry = {
          sokoBotId: delegation.turn.sokoBotId,
          userId: sokoBotActingUserId(delegation.turn),
          workspaceId: delegation.turn.workspaceId,
        };
        const key = `${retry.sokoBotId}:${retry.userId ?? ""}`;
        const work = byBot.get(key) ?? { ...retry, changes: [], baselines: [] };
        byBot.set(key, work);
        work.changes.push({
          delegationId: delegation.id,
          eventId: `${current.eventId ?? `${current.id}:${current.status}`}${FOLLOW_UP_RETRY_SUFFIX}`,
          eventAt: current.eventAt,
          designatedHandlerBotId: delegation.turn.sokoBotId,
          kind: delegation.task ? "TASK" : "JOB",
          entityId: current.id,
          name: current.name,
          from: delegation.lastSeenStatus,
          to: current.status,
          note: current.note,
          followUp: delegation.followUp,
          followUpAllows: delegationWakeAllows(delegation),
          retryOfTurnId: delegation.followUpTurnId,
          ownerGranted: ownerRequestGrant({
            ...delegation,
            followUpTurnId: null,
          }),
        });
        continue;
      }
      if (
        current.status === delegation.lastSeenStatus &&
        (!current.eventId || current.eventId === delegation.lastSeenEventId)
      ) {
        continue;
      }
      // A shared bot's delegations belong to different members; each result
      // turn runs for the member who asked for that work, never another one.
      const actingUserId = sokoBotActingUserId({
        requestedByUserId: delegation.turn.requestedByUserId,
        sokoBot: { userId: delegation.turn.sokoBot?.userId ?? null },
      });
      const workKey = `${delegation.turn.sokoBotId}:${actingUserId ?? ""}`;
      const work = byBot.get(workKey) ?? {
        sokoBotId: delegation.turn.sokoBotId,
        userId: actingUserId,
        workspaceId: delegation.turn.workspaceId,
        changes: [],
        baselines: [],
      };
      byBot.set(workKey, work);
      // A background run follows the Tasks and Jobs it started itself; an
      // event turn beside it would act on the same result without its plan.
      // The change stays unseen meanwhile: a run that fails before reading it
      // must not lose it, nor the follow-up waiting on it.
      if (delegation.turn.parentTurnId) {
        if (BACKGROUND_RUN_ACTIVE_STATUSES.has(delegation.turn.status))
          continue;
        // The owner stopped the run: its plan stops with it. A run that
        // finished and read the change handled it. A failed run did neither,
        // even if it read the result, so the follow-up wakes the bot.
        if (
          delegation.turn.status === "CANCELLED" ||
          (delegation.turn.status === "COMPLETED" &&
            (await backgroundRunReadChange(
              delegation.turnId,
              current,
              delegation,
            )))
        ) {
          work.baselines.push({
            delegationId: delegation.id,
            status: current.status,
            eventId: current.eventId,
            eventAt: current.eventAt ?? scan.createdAt,
          });
          continue;
        }
      }
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
                sokoBotId: true,
              },
            })
          : (
              await prisma.jobEvent.findMany({
                where: { jobId: current.id, ...cursor },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                take: MAX_CHANGES_PER_TURN,
                select: { id: true, createdAt: true, status: true },
              })
            ).map((event) => ({ ...event, comment: null, sokoBotId: null }));
        // The bot's own status change is not news to it: Joseph completed a
        // Task for its owner, then woke to report that the Task was completed.
        const actionable = events.filter(
          (event) =>
            event.status &&
            event.sokoBotId !== delegation.turn.sokoBotId &&
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
                (delegation.task.ownerId ===
                sokoBotActingUserId(delegation.turn)
                  ? delegation.turn.sokoBotId
                  : null))
              : delegation.turn.sokoBotId,
            kind: delegation.task ? "TASK" : "JOB",
            entityId: current.id,
            name: current.name,
            from: delegation.lastSeenStatus,
            to: event.status ?? current.status,
            note: event.comment,
            followUp: pendingFollowUp(delegation),
            followUpAllows: delegationWakeAllows(delegation),
            ownerGranted: ownerRequestGrant(delegation),
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
      // An ended run's change is new to it even on the first look: the run
      // kept it unseen while it worked. So is work with a plan waiting on
      // it: a hired Agent can finish before the first scan sees its Job.
      if (
        (delegation.lastSeenStatus === null &&
          !delegation.turn.parentTurnId &&
          !pendingFollowUp(delegation) &&
          (current.status === "COMPLETED" || current.status === "CANCELED")) ||
        current.byThisBot ||
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
            (delegation.task.ownerId === sokoBotActingUserId(delegation.turn)
              ? delegation.turn.sokoBotId
              : null))
          : delegation.turn.sokoBotId,
        kind: delegation.task ? "TASK" : "JOB",
        entityId: current.id,
        name: current.name,
        from: delegation.lastSeenStatus,
        to: current.status,
        note: current.note ?? null,
        followUp: pendingFollowUp(delegation),
        followUpAllows: delegationWakeAllows(delegation),
        ownerGranted: ownerRequestGrant(delegation),
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
        createCoreLogger({
          operation: OPERATION,
          sokoBot: { id: work.sokoBotId },
          wakeWithheld: {
            reason: gate.reason,
            usedToday: gate.usedToday,
            limit: gate.limit,
            changes: work.changes.length,
          },
        }).emit();
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
      const plans = followUpPlans(changes, work.changes);
      // The last occurrence of an entity claims its plans, so a batch with two
      // events on one Task hands the plan over once.
      const claimsOf = new Map(
        plans.flatMap((plan) => {
          const last = changes.findLast(
            (change) => change.entityId === plan.entityId,
          );
          return plan.due && last ? [[last, plan.delegationIds] as const] : [];
        }),
      );
      // A plan this wake carries out keeps the drafting tools of the owner's
      // request that attached it; any other wake keeps the event route's.
      const claimed = new Set([...claimsOf.values()].flat());
      const presetRoute = inheritedFollowUpRoute(
        work.changes.flatMap((change) =>
          claimed.has(change.delegationId) ? (change.ownerGranted ?? []) : [],
        ),
      );
      try {
        const started = await sokoBotControlPlane.startTurn({
          userId: work.userId,
          sokoBotId: work.sokoBotId,
          workspaceId: work.workspaceId,
          clientTurnId: sokoBotEventClientTurnId(changes),
          message: buildEventMessage(changes, plans),
          source: "EVENT",
          presetRoute,
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
            followUpDelegationIds: claimsOf.get(change),
            ...(change.retryOfTurnId && claimsOf.has(change)
              ? { followUpRetryOfTurnId: change.retryOfTurnId }
              : {}),
          })),
        });
        result.woken += 1;
        // The start result grants this call the drain after its own fresh start
        // or won recovery claim, including when a CAS proves its acknowledgement
        // committed despite a lost response. An observing duplicate leaves the
        // drain to the owner. The watchdog can take over after the heartbeat
        // goes stale, while the turn's deadline is still in the future.
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
              if (reportSokoBotReconciliationLeaseLoss(started.turnId, error))
                return;
              const log = createCoreLogger({
                operation: OPERATION,
                sokoBot: { id: work.sokoBotId },
                turn: { id: started.turnId },
              });
              log.error(
                createError({
                  message: "Soko Bot event turn reconciliation failed",
                  why: "Turn reconciliation threw",
                  fix: "The soko-bot-turns sync picks the turn up. If the turn stays stuck, check failure.errorName and failure.status.",
                }),
                // Only safe fields: turn work can echo its prompt.
                { failure: messageSafeErrorFields(error) },
              );
              log.emit();
            });
        }
      } catch (error) {
        if (error instanceof SokoBotBusyError) {
          // The bot is mid-turn; the drift stays unseen and retries next tick.
          result.deferred += 1;
          continue;
        }
        result.failed += 1;
        const log = createCoreLogger({
          operation: OPERATION,
          sokoBot: { id: work.sokoBotId },
        });
        log.error(
          createError({
            message:
              "Could not wake a Soko Bot for changes in its delegated work",
            why: "Starting the event turn threw",
            fix: "The changes stay unseen, so the next soko-bot-events sync wakes the bot again. If it fails every run, check failure.errorName and failure.status.",
          }),
          // Only safe fields: turn work can echo its prompt.
          { failure: messageSafeErrorFields(error) },
        );
        log.emit();
      }
    }
    if (
      !input.sokoBotId &&
      input.shouldContinue() &&
      !input.abortSignal.aborted
    ) {
      await prisma.syncMetadata.update({
        where: { key: scan.key },
        data: {
          cursorId:
            delegations.length === BATCH_SIZE ? delegations.at(-1)!.id : null,
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
          ...(item.eventAt !== undefined
            ? { lastSeenEventAt: item.eventAt }
            : {}),
        },
      });
    }
  }
}

export const sokoBotEventsSyncService = new SokoBotEventsSyncService();
