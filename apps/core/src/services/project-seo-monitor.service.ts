import type { z } from "@hono/zod-openapi";
import type { Prisma, TaskSchedule } from "@sokosumi/database";
import { badRequest, conflict, forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import { requireSeoAnalysisDispatch } from "@/lib/seo/analysis-dispatch";
import {
  parseSeoMonitorPlan,
  SEO_MONITOR_CRON,
  SEO_MONITOR_MARKER,
  seoMonitorPlanSchema,
} from "@/lib/seo/monitor-plan";
import {
  createSeoMonitorSchema,
  type ProjectSeoWorkspace,
  requestSeoAnalysisSchema,
  type SeoActor,
} from "@/schemas/project-seo.schema";

import {
  requestProjectSeoAnalysisInTransaction,
  validateSeoAnalysis,
} from "./project-seo-operations.service";
import { requireSeoProject, resolveSeoScope } from "./project-seo-store";
import { createTaskSchedule } from "./task-schedule.service";

function parsePacket(description: string | null) {
  try {
    return parseSeoMonitorPlan(description);
  } catch (error) {
    throw badRequest((error as Error).message);
  }
}

/** A human creates a bounded existing Task Schedule; the saved pages remain fixed for its lifetime. */
export async function createProjectSeoMonitor(
  vars: EnvVariables["Variables"],
  actor: SeoActor,
  input: z.infer<typeof createSeoMonitorSchema>,
) {
  if (actor.sokoBotId)
    throw forbidden("A person must approve recurring public SEO work");
  requireSeoAnalysisDispatch();
  await requireSeoProject(actor, prisma, true);
  if (input.analysis.kind === "audit_full")
    throw badRequest("Monitoring supports bounded focused analyses only");
  if (!input.analysis.coworkerId)
    throw badRequest("Choose the Coworker approved for each monitor Run");
  const scope = await resolveSeoScope(actor, input.analysis);
  if (
    input.analysis.scopeId &&
    input.analysis.expectedScopeVersion !== scope.version
  )
    throw conflict(
      "The page group changed. Reload it before scheduling monitoring.",
    );
  validateSeoAnalysis(
    input.analysis,
    scope.pages.map((page) => page.url),
  );
  const analysis = requestSeoAnalysisSchema.parse({
    ...input.analysis,
    scopeId: undefined,
    expectedScopeVersion: undefined,
    pageIds: scope.pageIds,
    idempotencyKey: "monitor-template",
  });
  const packet = seoMonitorPlanSchema.parse({
    version: 1,
    cadence: input.cadence,
    timeZone: input.timeZone,
    targetRunCount: input.targetRunCount,
    scopeVersion: scope.version,
    analysis,
  });
  return createTaskSchedule(vars, {
    operationId: input.operationId,
    name: `SEO ${input.cadence} ${analysis.kind.replaceAll("_", " ")}`,
    description: `${SEO_MONITOR_MARKER}${JSON.stringify(packet)}`,
    projectId: actor.projectId,
    visibility: "PUBLIC",
    assigneeId: analysis.coworkerId,
    rule: {
      expr: SEO_MONITOR_CRON[input.cadence],
      timezone: input.timeZone,
      endsMode: "AFTER",
      targetRunCount: input.targetRunCount,
    },
  });
}

/** Only the durable planned Run ledger may release this packet. Each Run gets its own request ID. */
export async function releaseSeoMonitorRun(
  tx: Prisma.TransactionClient,
  schedule: TaskSchedule,
  runId: string,
) {
  const packet = parsePacket(schedule.description);
  if (!packet) return null;
  if (
    !schedule.ownerId ||
    !schedule.projectId ||
    schedule.creatorUserId !== schedule.ownerId ||
    schedule.creatorCoworkerId ||
    schedule.creatorSokoBotId ||
    schedule.visibility !== "PUBLIC" ||
    schedule.assigneeId !== packet.analysis.coworkerId ||
    schedule.assigneeSokoBotId ||
    schedule.assigneeUserId ||
    schedule.expr !== SEO_MONITOR_CRON[packet.cadence] ||
    schedule.timezone !== packet.timeZone ||
    schedule.intervalDays ||
    schedule.endsMode !== "AFTER" ||
    schedule.targetRunCount !== packet.targetRunCount
  )
    throw forbidden(
      "The SEO monitor no longer matches its approved finite public blueprint",
    );
  const planned = await tx.taskScheduleRun.findFirst({
    where: {
      id: runId,
      scheduleId: schedule.id,
      state: "PLANNED",
      manual: false,
    },
    select: { id: true },
  });
  if (!planned)
    throw forbidden(
      "Request a one-off analysis instead of adding an unbudgeted monitor Run",
    );
  const actor: SeoActor = {
    projectId: schedule.projectId,
    workspaceId: schedule.workspaceId,
    userId: schedule.ownerId,
    organizationId: schedule.organizationId,
  };
  const input = requestSeoAnalysisSchema.parse({
    ...packet.analysis,
    idempotencyKey: `seo-monitor:${schedule.id}:${runId}`,
  });
  const analysis = await requestProjectSeoAnalysisInTransaction(
    actor,
    input,
    tx,
    {},
    packet.scopeVersion,
  );
  if (!analysis.taskId)
    throw conflict("The monitor analysis did not create its Task");
  return tx.task.update({
    where: { id: analysis.taskId },
    data: { scheduleId: schedule.id },
    select: { id: true, ownerId: true, assigneeUserId: true },
  });
}

export async function listProjectSeoMonitors(
  actor: SeoActor,
): Promise<ProjectSeoWorkspace["monitors"]> {
  const rows = await prisma.taskSchedule.findMany({
    where: {
      projectId: actor.projectId,
      workspaceId: actor.workspaceId,
      visibility: "PUBLIC",
      description: { startsWith: SEO_MONITOR_MARKER },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.flatMap((row) => {
    try {
      const packet = parsePacket(row.description);
      return packet
        ? [
            {
              id: row.id,
              name: row.name,
              state: row.state,
              nextRunAt: row.nextRunAt?.toISOString() ?? null,
              targetRunCount: packet.targetRunCount,
              releasedCount: row.releasedCount,
              pageIds: packet.analysis.pageIds ?? [],
              scopeVersion: packet.scopeVersion,
              countryCode: packet.analysis.countryCode,
              languageCode: packet.analysis.languageCode,
              devices: packet.analysis.devices,
              kind: packet.analysis.kind,
              maxProviderCalls: packet.analysis.maxProviderCalls,
              timeZone: row.timezone,
            },
          ]
        : [];
    } catch {
      return [];
    }
  });
}
