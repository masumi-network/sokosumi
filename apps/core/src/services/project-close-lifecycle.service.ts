import { Prisma, ProjectCloseOperationState } from "@sokosumi/database";

import { lockCalendarScope } from "@/helpers/calendar-locks";
import { conflict, notFound } from "@/helpers/error";
import { isSchedulableTaskStatus } from "@/helpers/task-schedule";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type {
  ProjectCloseRecoveryRequest,
  ProjectCloseRequest,
  ProjectCloseStatus,
} from "@/schemas/project-close.schema";

import { retireProjectSocialConnectionsForClose } from "@/services/project-social-connections.service";

interface ProjectCloseScope {
  projectId: string;
  workspaceId: string;
  actorUserId: string;
}

interface ProjectCloseOperationRecord {
  id: string;
  projectId: string;
  state: ProjectCloseOperationState;
  cutoffAt: Date;
  reason: string | null;
  attempts: number;
  failureSummary: Prisma.JsonValue | null;
  completedAt: Date | null;
}

interface ProjectCloseStatusClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "count"
  >;
}

function normalizeOptionalReason(reason: string | undefined): string | null {
  return reason?.trim() || null;
}

function parseFailure(
  value: Prisma.JsonValue | null,
): ProjectCloseStatus["failure"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const seriesTaskId = value.seriesTaskId;
  const message = value.message;
  if (
    (seriesTaskId !== null && typeof seriesTaskId !== "string") ||
    typeof message !== "string"
  ) {
    return null;
  }
  return { seriesTaskId, message };
}

async function mapStatus(
  tx: ProjectCloseStatusClient,
  operation: ProjectCloseOperationRecord,
  projectRevision: number,
): Promise<ProjectCloseStatus> {
  const owedOccurrenceCount = await tx.taskScheduleOccurrence.count({
    where: {
      sourceProjectId: operation.projectId,
      state: "PLANNED",
      effectiveScheduledAt: { lt: operation.cutoffAt },
      seriesTask: { status: "QUEUED" },
    },
  });

  return {
    id: operation.id,
    projectId: operation.projectId,
    state: operation.state,
    cutoffAt: operation.cutoffAt.toISOString(),
    reason: operation.reason,
    attempts: operation.attempts,
    failure: parseFailure(operation.failureSummary),
    completedAt: operation.completedAt?.toISOString() ?? null,
    projectRevision,
    owedOccurrenceCount,
  };
}

async function requireLockedProject(
  tx: Prisma.TransactionClient,
  scope: Pick<ProjectCloseScope, "actorUserId" | "projectId" | "workspaceId">,
) {
  if (
    !(await lockCalendarScope(
      tx,
      scope.workspaceId,
      [scope.projectId],
      scope.actorUserId,
    ))
  ) {
    throw notFound("Project not found");
  }

  const project = await tx.project.findFirst({
    where: { id: scope.projectId, workspaceId: scope.workspaceId },
    select: {
      id: true,
      projectRevision: true,
      closingAt: true,
      closedAt: true,
      closeOperation: true,
    },
  });
  if (!project) {
    throw notFound("Project not found");
  }
  return project;
}

function assertExpectedRevision(
  expectedProjectRevision: number,
  projectRevision: number,
): void {
  if (expectedProjectRevision !== projectRevision) {
    throw conflict(
      "The Project changed; reload it and retry with its current projectRevision",
    );
  }
}

function recoveryEventKey(operationId: string): string {
  return `project-close:recovery:${operationId}`;
}

async function isRecoveryReplay(
  tx: Prisma.TransactionClient,
  input: {
    action: "retry" | "cancel-owed";
    closeOperationId: string;
    operationId: string;
    reason: string;
  },
): Promise<boolean> {
  const event = await tx.projectEvent.findUnique({
    where: { eventKey: recoveryEventKey(input.operationId) },
    select: { closeOperationId: true, reason: true, payload: true },
  });
  if (!event) return false;

  const payload = event.payload;
  if (
    event.closeOperationId !== input.closeOperationId ||
    event.reason !== input.reason ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.action !== input.action
  ) {
    throw conflict("Idempotency key was already used for another operation");
  }
  return true;
}

export async function requestProjectClose(
  scope: ProjectCloseScope,
  input: ProjectCloseRequest,
): Promise<ProjectCloseStatus> {
  return await serializableTransaction(async (tx) => {
    const project = await requireLockedProject(tx, scope);
    const reason = normalizeOptionalReason(input.reason);
    if (project.closeOperation) {
      if (
        project.closeOperation.id === input.operationId &&
        project.closeOperation.reason === reason
      ) {
        return await mapStatus(
          tx,
          project.closeOperation,
          project.projectRevision,
        );
      }
      throw conflict("Project close has already been requested");
    }
    if (project.closingAt || project.closedAt) {
      throw conflict("Project is already closing or closed");
    }
    assertExpectedRevision(
      input.expectedProjectRevision,
      project.projectRevision,
    );

    const reusedOperation = await tx.projectCloseOperation.findUnique({
      where: { id: input.operationId },
      select: { id: true },
    });
    if (reusedOperation) {
      throw conflict("Idempotency key was already used for another operation");
    }

    const cutoffAt = new Date();
    const updated = await tx.project.update({
      where: { id: project.id },
      data: {
        closingAt: cutoffAt,
        projectRevision: { increment: 1 },
      },
      select: { projectRevision: true },
    });
    await retireProjectSocialConnectionsForClose(
      tx,
      project.id,
      scope.actorUserId,
    );
    const operation = await tx.projectCloseOperation.create({
      data: {
        id: input.operationId,
        projectId: project.id,
        cutoffAt,
        actorUserId: scope.actorUserId,
        reason,
        nextAttemptAt: cutoffAt,
      },
    });
    await tx.projectEvent.create({
      data: {
        projectId: project.id,
        closeOperationId: operation.id,
        eventKey: `project-close:request:${operation.id}`,
        kind: "CLOSE_REQUESTED",
        actorUserId: scope.actorUserId,
        reason,
        payload: { cutoffAt: cutoffAt.toISOString() },
      },
    });

    return await mapStatus(tx, operation, updated.projectRevision);
  }, "Project changed during close request");
}

export async function getProjectCloseStatus(
  scope: Pick<ProjectCloseScope, "projectId" | "workspaceId">,
): Promise<ProjectCloseStatus> {
  const project = await prisma.project.findFirst({
    where: { id: scope.projectId, workspaceId: scope.workspaceId },
    select: { projectRevision: true, closeOperation: true },
  });
  if (!project) throw notFound("Project not found");
  if (!project.closeOperation) throw notFound("Project close not found");

  return await mapStatus(
    prisma,
    project.closeOperation,
    project.projectRevision,
  );
}

async function recoverProjectClose(
  scope: ProjectCloseScope,
  input: ProjectCloseRecoveryRequest,
  action: "retry" | "cancel-owed",
): Promise<ProjectCloseStatus> {
  return await serializableTransaction(async (tx) => {
    const project = await requireLockedProject(tx, scope);
    const operation = project.closeOperation;
    if (!operation) throw notFound("Project close not found");
    const reason = input.reason.trim();
    if (
      await isRecoveryReplay(tx, {
        action,
        closeOperationId: operation.id,
        operationId: input.operationId,
        reason,
      })
    ) {
      return await mapStatus(tx, operation, project.projectRevision);
    }
    assertExpectedRevision(
      input.expectedProjectRevision,
      project.projectRevision,
    );
    if (operation.state !== ProjectCloseOperationState.CLOSE_FAILED) {
      throw conflict("Project close is not waiting for recovery");
    }

    if (action === "cancel-owed") {
      const failure = parseFailure(operation.failureSummary);
      if (!failure?.seriesTaskId) {
        throw conflict("Project close has no failed series to cancel");
      }
      await tx.taskScheduleOccurrence.updateMany({
        where: {
          seriesTaskId: failure.seriesTaskId,
          sourceProjectId: project.id,
          scheduleVersion: 2,
          OR: [
            {
              state: "PLANNED",
              effectiveScheduledAt: { lt: operation.cutoffAt },
            },
            {
              state: { in: ["PLANNED", "SKIPPED"] },
              effectiveScheduledAt: { gte: operation.cutoffAt },
            },
          ],
        },
        data: { state: "CANCELED" },
      });
      await tx.taskScheduleOccurrence.deleteMany({
        where: {
          seriesTaskId: failure.seriesTaskId,
          sourceProjectId: project.id,
          scheduleVersion: 1,
          state: "PLANNED",
        },
      });
      await tx.taskScheduleQuarantine.deleteMany({
        where: { taskId: failure.seriesTaskId },
      });
      const failedTask = await tx.task.findFirst({
        where: { id: failure.seriesTaskId, projectId: project.id },
        select: { status: true },
      });
      if (failedTask) {
        await tx.task.updateMany({
          where: {
            id: failure.seriesTaskId,
            projectId: project.id,
          },
          data: {
            ...(isSchedulableTaskStatus(failedTask.status)
              ? { status: "DRAFT" }
              : {}),
            metadata: null,
            nextRunAt: null,
            scheduleRevision: { increment: 1 },
          },
        });
      }
    }

    const nextRevision = await tx.project.update({
      where: { id: project.id },
      data: { projectRevision: { increment: 1 } },
      select: { projectRevision: true },
    });
    const recovered = await tx.projectCloseOperation.update({
      where: { id: operation.id },
      data: {
        state: ProjectCloseOperationState.CLOSING,
        attempts: 0,
        leaseToken: null,
        leasedAt: null,
        nextAttemptAt: new Date(),
        failureSummary: Prisma.DbNull,
        ...(action === "cancel-owed"
          ? {
              seriesCursor: parseFailure(operation.failureSummary)
                ?.seriesTaskId,
            }
          : {}),
      },
    });
    await tx.projectEvent.create({
      data: {
        projectId: project.id,
        closeOperationId: operation.id,
        eventKey: recoveryEventKey(input.operationId),
        kind: action === "retry" ? "RETRY_REQUESTED" : "SERIES_RESOLVED",
        actorUserId: scope.actorUserId,
        reason,
        payload: { action, recoveryOperationId: input.operationId },
      },
    });

    return await mapStatus(tx, recovered, nextRevision.projectRevision);
  }, "Project changed during close recovery");
}

export async function retryProjectClose(
  scope: ProjectCloseScope,
  input: ProjectCloseRecoveryRequest,
): Promise<ProjectCloseStatus> {
  return await recoverProjectClose(scope, input, "retry");
}

export async function cancelProjectCloseOwedWork(
  scope: ProjectCloseScope,
  input: ProjectCloseRecoveryRequest,
): Promise<ProjectCloseStatus> {
  return await recoverProjectClose(scope, input, "cancel-owed");
}
