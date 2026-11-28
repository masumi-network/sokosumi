import { type Prisma } from "@sokosumi/database";
import { computeJobStatus } from "@sokosumi/database/helpers";
import { jobForStatusComputeSelect } from "@sokosumi/database/types/job";
import {
  assertDirectOwnerScheduleEdit,
  bindScheduleStopRule,
  type DirectOwnerScheduleEdit,
  evaluateScheduleStopRule,
  getSokoBotVersion,
  narrowOwnerAuthority,
  OwnerAuthorityError,
  type OwnerAuthorityStopRuleInput,
  ownerAuthoritySchema,
  type SokoBotCapability,
  sokoBotScheduleIdInputSchema as scheduleIdInputSchema,
  sokoBotUpdateScheduleInputSchema as updateScheduleInputSchema,
} from "@sokosumi/soko-bot";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { createNetworkScope, type NetworkScope } from "@/lib/db/network-scope";
import {
  attenuateForChildWork,
  mintTurnOwnerAuthority,
  mintUiOwnerAuthority,
  type OwnerAuthorityAskedByKind,
} from "@/lib/soko-bot/owner-authority";
import { OWN_SCHEDULE_CAPABILITIES } from "@/lib/soko-bot/system-routes";
import {
  type ResolveScheduleAuthority,
  SokoBotScheduleNotFoundError,
  SokoBotScheduleValidationError,
  verifyScheduleStopAuthority,
} from "@/services/soko-bot-schedule.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

const SETTLED_TASK_STATUSES: ReadonlySet<string> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELED",
]);

const SETTLED_JOB_STATUSES: ReadonlySet<SokosumiJobStatus> = new Set([
  SokosumiJobStatus.COMPLETED,
  SokosumiJobStatus.FAILED,
  SokosumiJobStatus.PAYMENT_FAILED,
  SokosumiJobStatus.REFUND_RESOLVED,
  SokosumiJobStatus.DISPUTE_RESOLVED,
]);

function resolveAskedByKind(
  authorized: Pick<AuthorizedSokoBotRuntime, "askedByKind" | "turn">,
  sharedBot: boolean,
): OwnerAuthorityAskedByKind {
  if (
    authorized.askedByKind === "OWNER" ||
    authorized.askedByKind === "TEAMMATE" ||
    authorized.askedByKind === "ASSISTANT"
  ) {
    return authorized.askedByKind;
  }
  if (authorized.turn.chainDepth > 0) return "ASSISTANT";
  if (sharedBot) return "TEAMMATE";
  if (
    authorized.turn.askedByUserId !== null &&
    authorized.turn.askedByUserId !== undefined &&
    authorized.turn.askedByUserId !== authorized.turn.requestedByUserId
  ) {
    return "TEAMMATE";
  }
  return "OWNER";
}

function directOwnerChatScheduleEdit(
  authorized: Pick<AuthorizedSokoBotRuntime, "askedByKind" | "turn">,
  sharedBot: boolean,
): DirectOwnerScheduleEdit | undefined {
  const isCmo = getSokoBotVersion(authorized.turn.versionId).profile === "cmo";
  const askedByKind = resolveAskedByKind(authorized, sharedBot);
  const actorUserId = authorized.turn.actingUserId;
  const askedByUserId = authorized.turn.askedByUserId ?? null;
  const ownerAsked =
    askedByKind === "OWNER" &&
    (askedByUserId === null ||
      askedByUserId === authorized.turn.requestedByUserId);
  const cmoTeammateAsked = isCmo && askedByKind === "TEAMMATE";
  if (
    authorized.turn.source !== "CHAT" ||
    (authorized.turn.parentTurnId ?? null) !== null ||
    authorized.turn.chainDepth !== 0 ||
    actorUserId === null ||
    (!ownerAsked && !cmoTeammateAsked)
  ) {
    return undefined;
  }
  return {
    kind: "owner_chat",
    actorUserId,
    sokoBotId: authorized.turn.sokoBotId,
    workspaceId: authorized.turn.workspaceId,
    turnId: authorized.turn.id,
    source: authorized.turn.source,
    parentTurnId: authorized.turn.parentTurnId ?? null,
    chainDepth: authorized.turn.chainDepth,
    askedByKind,
    allowWorkspaceMember: isCmo && sharedBot,
  };
}

/**
 * Bounds a schedule's requested capabilities by the authoring turn's grant so
 * a job can declare a narrower toolset (such as a read-only check from a
 * broader turn) without escalating beyond what the authoring turn holds.
 */
export function resolveRequestedScheduleCapabilities(
  requested: readonly string[] | undefined,
  granted: readonly SokoBotCapability[],
): SokoBotCapability[] {
  if (requested === undefined) {
    return [...granted];
  }
  const grantSet = new Set<string>(granted);
  const uniqueRequested = [...new Set(requested)];
  const unavailable = uniqueRequested.filter(
    (capability) => !grantSet.has(capability),
  );
  if (unavailable.length > 0) {
    throw new SokoBotRuntimeValidationError(
      `This turn does not have permission to grant ${unavailable.join(", ")} to a schedule. Request only capabilities available in this turn.`,
    );
  }
  return uniqueRequested as SokoBotCapability[];
}

/**
 * Resolves the persisted OwnerAuthority for a bot `create_schedule` or
 * `update_schedule` tool call.
 *
 * - Brand-new schedules always persist an attenuated OwnerAuthority bound to
 *   the concrete `scheduleId` (retaining any project scope separately).
 * - Unrelated edits/upserts (neither `stopRule`, `allowScheduledPosts`, nor a
 *   direct-owner / legacy capability upgrade) preserve any existing persisted
 *   authority verbatim.
 * - Setting/clearing `stopRule` or changing `allowScheduledPosts` requires a
 *   direct top-level owner chat turn; later top-level owner chat edits on an
 *   existing owner-originated schedule preserve `grantId`, `origin`,
 *   `rootTurnId`, `targetScope`, `scheduleId`, `limits`, and `expiresAt`.
 */
export function resolveBotScheduleAuthority(
  authorized: Pick<AuthorizedSokoBotRuntime, "askedByKind" | "turn">,
  input: {
    stopRule?: OwnerAuthorityStopRuleInput;
    allowScheduledPosts?: boolean;
    /** Job-specific capabilities requested on create/update, when updating job scope. */
    capabilities?: readonly SokoBotCapability[];
  },
  options: { isUpdate: boolean },
): ResolveScheduleAuthority {
  return (context) => {
    const isCmo =
      getSokoBotVersion(authorized.turn.versionId ?? context.botVersionId)
        .profile === "cmo";
    const scheduleEdit = directOwnerChatScheduleEdit(
      authorized,
      context.sharedBot,
    );
    const wantsAuthorityEdit =
      input.stopRule !== undefined || input.allowScheduledPosts !== undefined;
    const wantsCapabilitiesEdit = input.capabilities !== undefined;
    const upgradesSystemToOwner =
      wantsCapabilitiesEdit &&
      scheduleEdit !== undefined &&
      context.existingAuthority?.origin === "system";
    const initializesLegacyCapabilities =
      wantsCapabilitiesEdit && context.existingAuthority === null;

    if (options.isUpdate || context.existingAuthority !== null) {
      if (
        !wantsAuthorityEdit &&
        !upgradesSystemToOwner &&
        !initializesLegacyCapabilities
      ) {
        return undefined;
      }
      if (wantsAuthorityEdit && !scheduleEdit) {
        throw new OwnerAuthorityError(
          "Only a direct top-level owner chat turn may change a schedule's stop rule or posting permission",
        );
      }
      if (
        context.existingAuthority !== null &&
        context.existingAuthority.origin !== "system"
      ) {
        let next = context.existingAuthority;
        if (input.allowScheduledPosts !== undefined) {
          assertDirectOwnerScheduleEdit(
            next,
            scheduleEdit!,
            input.allowScheduledPosts
              ? "authorize a personal schedule to schedule posts"
              : "change a schedule's posting permission",
          );
          if (!isCmo) {
            next = input.allowScheduledPosts
              ? ownerAuthoritySchema.parse({
                  ...next,
                  scheduleId: next.scheduleId ?? context.scheduleId,
                  socialMode: "schedule_posts",
                })
              : narrowOwnerAuthority(next, {
                  scheduleId: context.scheduleId,
                  socialMode: "draft_only",
                  keepStopRule: true,
                });
          }
        }
        if (input.stopRule !== undefined) {
          next = bindScheduleStopRule(next, {
            scheduleId: context.scheduleId,
            stopRule: input.stopRule,
            edit: scheduleEdit!,
          });
        }
        return next;
      }
    }

    const askedByKind = resolveAskedByKind(authorized, context.sharedBot);
    const projectId = context.botProjectId ?? authorized.turn.botProjectId;
    const parent = mintTurnOwnerAuthority({
      turn: {
        id: authorized.turn.id,
        sokoBotId: context.sokoBotId,
        workspaceId: context.workspaceId,
        versionId: authorized.turn.versionId ?? context.botVersionId,
        source: authorized.turn.source,
        parentTurnId: authorized.turn.parentTurnId ?? null,
        chainDepth: authorized.turn.chainDepth,
        askedByUserId: authorized.turn.askedByUserId ?? null,
        requestedByUserId: authorized.turn.requestedByUserId,
      },
      actingUserId: authorized.turn.actingUserId,
      askedByKind,
      targetScope: projectId
        ? { kind: "project", projectId }
        : { kind: "workspace" },
    });

    if (input.allowScheduledPosts === false && !scheduleEdit) {
      throw new OwnerAuthorityError(
        "Only a direct top-level owner chat turn may change a schedule's posting permission",
      );
    }

    return attenuateForChildWork(parent, "schedule", {
      versionId: authorized.turn.versionId ?? context.botVersionId,
      scheduleId: context.scheduleId,
      scheduleEdit,
      stopRule: input.stopRule,
      allowScheduledPosts: input.allowScheduledPosts,
    });
  };
}

/**
 * Resolves the persisted OwnerAuthority for an authenticated owner UI
 * `createSchedule` or `updateSchedule` action.
 */
export function resolveUiScheduleAuthority(
  userId: string,
  stopRule?: OwnerAuthorityStopRuleInput,
): ResolveScheduleAuthority {
  return (context) => {
    const uiEdit: DirectOwnerScheduleEdit = {
      kind: "owner_ui",
      actorUserId: userId,
      sokoBotId: context.sokoBotId,
      workspaceId: context.workspaceId,
      allowWorkspaceMember: context.sharedBot,
    };
    if (context.existingAuthority !== null) {
      if (stopRule === undefined) return undefined;
      if (context.existingAuthority.origin !== "system") {
        return bindScheduleStopRule(context.existingAuthority, {
          scheduleId: context.scheduleId,
          stopRule,
          edit: uiEdit,
        });
      }
    }
    const parent = mintUiOwnerAuthority({
      sokoBotId: context.sokoBotId,
      workspaceId: context.workspaceId,
      ownerUserId: userId,
      targetScope: context.botProjectId
        ? { kind: "project", projectId: context.botProjectId }
        : { kind: "workspace" },
    });
    return attenuateForChildWork(parent, "schedule", {
      versionId: context.botVersionId,
      scheduleId: context.scheduleId,
      scheduleEdit: uiEdit,
      stopRule,
    });
  };
}

/** Schedule tools never need approval; their domain errors become tool errors the model can read. */
export async function runScheduleTool<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof SokoBotScheduleNotFoundError ||
      error instanceof SokoBotScheduleValidationError
    ) {
      throw new SokoBotRuntimeValidationError(error.message);
    }
    throw error;
  }
}

export interface RequireScheduledRunMayEndOptions {
  now?: Date;
  readJobStatus?: (input: {
    jobId: string;
    workspaceId: string;
  }) => Promise<SokosumiJobStatus | null>;
  checkOrganizationSeat?: (
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ) => Promise<boolean>;
}

async function readScheduleJobStatus(
  scope: NetworkScope,
  input: { jobId: string; workspaceId: string },
): Promise<SokosumiJobStatus | null> {
  const job = await scope.networkDb.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: jobForStatusComputeSelect,
  });
  return job ? computeJobStatus(job) : null;
}

/**
 * A scheduled run deletes or switches off a schedule only when it is its own
 * and its persisted OwnerAuthority stop rule verifies against live state
 * (including live grantor membership and seat for shared schedules). Legacy
 * schedules without persisted authority (`authority === null`) keep running
 * until an owner explicitly binds a typed stop rule.
 */
export async function requireScheduledRunMayEnd(
  tx: Prisma.TransactionClient,
  turnId: string,
  capability: SokoBotCapability,
  rawInput: unknown,
  authorized?: Pick<
    AuthorizedSokoBotRuntime,
    "askedByKind" | "turn" | "scope"
  > & {
    grant: { capabilities: readonly SokoBotCapability[] };
  },
  options?: RequireScheduledRunMayEndOptions,
) {
  const ends =
    capability === "delete_schedule" ||
    (capability === "update_schedule" &&
      updateScheduleInputSchema.safeParse(rawInput).data?.enabled === false);
  if (!ends) return;
  const refusal =
    "A scheduled run doesn't delete or switch off schedules unless its owner authorized a stop rule that is now met. Report what you found and let the owner decide.";
  const run = await tx.sokoBotScheduleRun.findUnique({
    where: { turnId },
    select: {
      id: true,
      status: true,
      schedule: {
        select: {
          id: true,
          name: true,
          prompt: true,
          sokoBotId: true,
          workspaceId: true,
          completedRuns: true,
          authority: true,
          sokoBot: {
            select: {
              userId: true,
              archivedAt: true,
              status: true,
              adminPausedAt: true,
              projectId: true,
              versionId: true,
            },
          },
        },
      },
    },
  });
  if (!run) throw new SokoBotRuntimeValidationError(refusal);
  const ref = (
    capability === "update_schedule"
      ? updateScheduleInputSchema
      : scheduleIdInputSchema
  ).safeParse(rawInput);
  const own =
    ref.success &&
    (ref.data.scheduleId
      ? ref.data.scheduleId === run.schedule.id
      : ref.data.scheduleName?.trim().toLowerCase() ===
        run.schedule.name.trim().toLowerCase());
  if (!own) throw new SokoBotRuntimeValidationError(refusal);

  // Fail closed on legacy (`authority === null`) or malformed rows, and verify
  // live bot state + grantor workspace membership & assigned organization seat
  // via the same helper settlement-time auto-stopping uses.
  const now = options?.now ?? new Date();
  const sharedBot = run.schedule.sokoBot
    ? run.schedule.sokoBot.userId === null
    : false;
  const verified = await verifyScheduleStopAuthority(tx, {
    schedule: run.schedule,
    sokoBotId: authorized?.turn.sokoBotId ?? run.schedule.sokoBotId,
    workspaceId: authorized?.turn.workspaceId ?? run.schedule.workspaceId,
    actingUserId: authorized?.turn.actingUserId,
    askedByKind: authorized
      ? resolveAskedByKind(authorized, sharedBot)
      : undefined,
    versionId: authorized?.turn.versionId,
    offeredCapabilities: authorized
      ? authorized.grant.capabilities
      : [capability],
    now,
    checkOrganizationSeat: options?.checkOrganizationSeat,
  });
  if (!verified.effective) {
    throw new SokoBotRuntimeValidationError(refusal);
  }

  let completedRuns: number | undefined;
  let targetSettled: boolean | undefined;
  let settledTargetKind: "task" | "job" | undefined;
  let settledTargetId: string | undefined;

  if (verified.authority.stopRule.mode === "ends_after_runs") {
    // Use the durable completed run counter on SokoBotSchedule (survives the
    // 7-day run retention purge and never counts an unfinished active run).
    completedRuns = run.schedule.completedRuns;
  } else if (verified.authority.stopRule.mode === "when_target_settled") {
    const { targetKind, targetId } = verified.authority.stopRule;
    settledTargetKind = targetKind;
    settledTargetId = targetId;
    if (targetKind === "task") {
      const task = await tx.task.findFirst({
        where: { id: targetId, workspaceId: run.schedule.workspaceId },
        select: { status: true },
      });
      targetSettled = task !== null && SETTLED_TASK_STATUSES.has(task.status);
    } else {
      const target = { jobId: targetId, workspaceId: run.schedule.workspaceId };
      // Unattended schedules without a parent turn run on Mainnet.
      const jobStatus = options?.readJobStatus
        ? await options.readJobStatus(target)
        : await readScheduleJobStatus(
            authorized?.scope ?? createNetworkScope("mainnet"),
            target,
          );
      targetSettled = jobStatus !== null && SETTLED_JOB_STATUSES.has(jobStatus);
    }
  }

  const evaluation = evaluateScheduleStopRule(verified.authority, {
    sokoBotId: run.schedule.sokoBotId,
    workspaceId: run.schedule.workspaceId,
    ownScheduleId: run.schedule.id,
    targetScheduleId: run.schedule.id,
    now,
    revoked: !verified.botAlive,
    completedRuns,
    targetSettled,
    settledTargetKind,
    settledTargetId,
    ownerConditionVerified: false,
  });
  if (!evaluation.allowed) {
    throw new SokoBotRuntimeValidationError(refusal);
  }
}

/**
 * A schedule run gets update/delete for its own schedule even when the turn
 * that wrote the schedule had no schedule tools (an owner-made one). Those
 * extra tools reach that schedule only.
 */
export async function requireOwnScheduleScope(
  tx: Prisma.TransactionClient,
  turnId: string,
  capability: SokoBotCapability,
  rawInput: unknown,
) {
  if (
    !(OWN_SCHEDULE_CAPABILITIES as readonly SokoBotCapability[]).includes(
      capability,
    )
  )
    return;
  const run = await tx.sokoBotScheduleRun.findUnique({
    where: { turnId },
    select: {
      schedule: { select: { id: true, name: true, capabilityNames: true } },
    },
  });
  if (!run || run.schedule.capabilityNames.includes(capability)) return;
  const ref = (
    capability === "update_schedule"
      ? updateScheduleInputSchema
      : scheduleIdInputSchema
  ).safeParse(rawInput);
  const own =
    ref.success &&
    (ref.data.scheduleId
      ? ref.data.scheduleId === run.schedule.id
      : ref.data.scheduleName?.trim().toLowerCase() ===
        run.schedule.name.trim().toLowerCase());
  if (!own)
    throw new SokoBotRuntimeValidationError(
      `This run may only change its own schedule "${run.schedule.name}" (${run.schedule.id})`,
    );
}
