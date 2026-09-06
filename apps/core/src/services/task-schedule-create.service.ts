import { createHash, randomUUID } from "node:crypto";

import { type Prisma, TaskStatus, VendorGrantStatus } from "@sokosumi/database";

import {
  requireCoworkerCapability,
  type TaskAssigner,
} from "@/helpers/access-control";
import { lockCalendarScope } from "@/helpers/calendar-locks";
import { conflict, notFound } from "@/helpers/error";
import {
  buildTaskScheduleMetadataV2,
  computeScheduleNextRun,
  validateScheduleInput,
} from "@/helpers/task-schedule";
import { replaceTaskSchedulePlannedOccurrences } from "@/helpers/task-schedule-occurrence-index";
import {
  getWorkspaceGrant,
  throwGrantAccessError,
} from "@/helpers/vendor-grants";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  requireUserContext,
  type UserContext,
} from "@/middleware/auth";
import type { CreateTaskContext } from "@/schemas/task.schema";
import type { TaskScheduleInput } from "@/schemas/task-schedule.schema";

import {
  createTaskForActor,
  type TaskDomainActor,
} from "./task-domain.service";

export interface ScheduledTaskCreator {
  userContext: UserContext;
  actor: TaskDomainActor;
  assigneeAuthorization?: TaskAssigner;
}

export interface CreateScheduledTaskInput {
  creator: ScheduledTaskCreator;
  workspaceId: string;
  organizationId: string | null;
  operationId: string;
  source: { type: "workspace" } | { type: "project"; projectId: string };
  name: string;
  description?: string | null;
  assigneeId: string;
  schedule: TaskScheduleInput;
  requestFingerprintPayload?: {
    name: string | null;
    description: string | null;
    context: CreateTaskContext | null;
  };
}

type TaskScheduleCreateOperationDatabase = Pick<
  Prisma.TransactionClient,
  "taskScheduleCreateOperation"
>;

function createScheduledTaskRequestFingerprint(
  input: CreateScheduledTaskInput,
): string {
  const projectId =
    input.source.type === "project" ? input.source.projectId : null;
  const schedule =
    input.schedule.mode === "once"
      ? {
          mode: "once",
          runAt: input.schedule.runAt,
        }
      : {
          mode: "recurring",
          expr: input.schedule.expr,
          timezone: input.schedule.timezone,
          endsMode: input.schedule.endsMode,
          endsOn: input.schedule.endsOn ?? null,
          occurrences: input.schedule.occurrences ?? null,
          intervalDays: input.schedule.intervalDays ?? null,
          anchorAt: input.schedule.anchorAt ?? null,
        };
  const canonicalPayload = JSON.stringify({
    workspaceId: input.workspaceId,
    source: {
      type: projectId ? "project" : "workspace",
      projectId,
    },
    assigneeId: input.assigneeId,
    request: input.requestFingerprintPayload ?? {
      name: input.name,
      description: input.description ?? null,
    },
    schedule,
  });

  return createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}

/**
 * Finds an idempotent scheduled-Task result, rejecting operationId reuse with
 * a different raw request before the route performs external work.
 */
export async function findScheduledTaskCreateOperation(
  input: CreateScheduledTaskInput,
  db: TaskScheduleCreateOperationDatabase,
): Promise<string | null> {
  const requestFingerprint = createScheduledTaskRequestFingerprint(input);
  const existingOperation = await db.taskScheduleCreateOperation.findUnique({
    where: {
      workspaceId_operationId: {
        workspaceId: input.workspaceId,
        operationId: input.operationId,
      },
    },
    select: { taskId: true, requestFingerprint: true },
  });
  if (!existingOperation) {
    return null;
  }
  if (existingOperation.requestFingerprint !== requestFingerprint) {
    throw conflict(
      "operationId was already used with a different scheduled Task request",
    );
  }
  return existingOperation.taskId;
}

/**
 * Resolves an authenticated scheduled-Task creator. Coworkers need a GRANTED
 * vendor workspace grant because scheduled work is an immediate workspace-wide
 * commitment, not a GRANT_PENDING delegated draft.
 */
export async function requireScheduledTaskCreator(
  authContext: AuthenticationContext,
  workspaceId: string,
  tx?: Prisma.TransactionClient,
): Promise<ScheduledTaskCreator> {
  const userContext = requireUserContext(authContext);
  if (!isCoworkerAuthContext(authContext)) {
    return {
      userContext,
      actor: { kind: "user", userId: userContext.userId },
    };
  }

  await requireCoworkerCapability(authContext.coworkerId, "tasks", tx);
  const grant = await getWorkspaceGrant(
    { vendorId: authContext.vendorId, workspaceId },
    tx,
  );
  if (grant?.status !== VendorGrantStatus.GRANTED) {
    throwGrantAccessError(grant?.status);
  }

  return {
    userContext,
    actor: {
      kind: "coworker",
      coworkerId: authContext.coworkerId,
      vendorId: authContext.vendorId,
      enforceWorkspaceGrant: false,
    },
    // The grant authorizes the contextual workspace user to choose any usable
    // task-capable Coworker, including one from another vendor.
    assigneeAuthorization: { kind: "user", userId: userContext.userId },
  };
}

/**
 * Creates one scheduled Task, its v2 occurrence index, and an idempotency
 * result record in the caller's transaction.
 */
export async function createScheduledTaskInTransaction(
  input: CreateScheduledTaskInput,
  tx: Prisma.TransactionClient,
): Promise<string> {
  const existingTaskId = await findScheduledTaskCreateOperation(input, tx);
  if (existingTaskId) {
    return existingTaskId;
  }

  const requestFingerprint = createScheduledTaskRequestFingerprint(input);

  validateScheduleInput(input.schedule);
  const projectId =
    input.source.type === "project" ? input.source.projectId : null;
  if (projectId) {
    const project = await tx.project.findFirst({
      where: { id: projectId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!project) {
      throw notFound("Project not found");
    }
  }
  if (!(await lockCalendarScope(tx, input.workspaceId, [projectId]))) {
    throw conflict(
      "Task Calendar source changed during scheduled Task creation",
    );
  }

  const taskIdAfterScopeLock = await findScheduledTaskCreateOperation(
    input,
    tx,
  );
  if (taskIdAfterScopeLock) {
    return taskIdAfterScopeLock;
  }

  if (projectId) {
    const project = await tx.project.findFirst({
      where: { id: projectId, workspaceId: input.workspaceId },
      select: { id: true, closingAt: true, closedAt: true },
    });
    if (!project) {
      throw notFound("Project not found");
    }
    if (project.closingAt || project.closedAt) {
      throw conflict("Cannot schedule work in a closing or closed Project");
    }
  }

  const metadata = buildTaskScheduleMetadataV2(
    input.schedule,
    new Date(),
    randomUUID(),
  );
  const nextRunAt = computeScheduleNextRun(metadata);
  if (!nextRunAt) {
    throw conflict("Unable to compute the next scheduled run");
  }

  const task = await createTaskForActor(
    {
      actor: input.creator.actor,
      ownerId: input.creator.userContext.userId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      projectId,
      name: input.name,
      description: input.description,
      assigneeId: input.assigneeId,
      assigneeAuthorization: input.creator.assigneeAuthorization,
      status: TaskStatus.QUEUED,
      schedule: { metadata, nextRunAt },
    },
    tx,
  );
  await replaceTaskSchedulePlannedOccurrences(tx, {
    id: task.id,
    workspaceId: input.workspaceId,
    projectId,
    schedule: metadata,
    nextRunAt,
  });
  await tx.taskScheduleCreateOperation.create({
    data: {
      workspaceId: input.workspaceId,
      operationId: input.operationId,
      taskId: task.id,
      requestFingerprint,
    },
  });

  return task.id;
}
