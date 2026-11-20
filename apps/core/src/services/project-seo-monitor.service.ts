import type { z } from "@hono/zod-openapi";
import type { Prisma, TaskSchedule } from "@sokosumi/database";
import { badRequest, conflict, forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import {
  requireSeoAnalysisDispatch,
  requireSeoAnalysisExecutor,
} from "@/lib/seo/analysis-dispatch";
import {
  requireSeoAnalysisBalance,
  requireSeoFullAuditPriceApproval,
  seoAnalysisAdmissionCredits,
} from "@/lib/seo/analysis-price";
import {
  parseSeoMonitorPlan,
  SEO_MONITOR_MARKER,
  seoMonitorDescription,
} from "@/lib/seo/monitor-plan";
import {
  createSeoMonitorSchema,
  type ProjectSeoWorkspace,
  requestSeoAnalysisSchema,
  type SeoActor,
} from "@/schemas/project-seo.schema";
import type { CreateTaskScheduleRunRequest } from "@/schemas/task-schedule.schema";
import { readSeoMonitorRuns } from "./project-seo-monitor-runs";
import {
  auditPageSelection,
  requestProjectSeoAnalysisInTransaction,
  seoTaskPacket,
  validateSeoAnalysis,
} from "./project-seo-operations.service";
import { requireSeoOwner, resolveSeoScope } from "./project-seo-store";
import { checkAuditSearchConsole } from "./seo-audit-search-console";
import {
  type ManualSeoRunApproval,
  readMonitorSearchConsoleApproval,
  saveMonitorSearchConsoleApproval,
} from "./seo-monitor-search-console";
import { createTaskSchedule } from "./task-schedule.service";

const SEO_MONITOR_LIST_LIMIT = 50;

function parsePacket(description: string | null) {
  try {
    return parseSeoMonitorPlan(description);
  } catch (error) {
    throw badRequest((error as Error).message);
  }
}

/** A human creates an existing Task Schedule with an approved rule; the saved pages remain fixed for its lifetime. */
export async function createProjectSeoMonitor(
  vars: EnvVariables["Variables"],
  actor: SeoActor,
  input: z.infer<typeof createSeoMonitorSchema>,
  origin: "interactive" | "cmo-subscription" = "interactive",
) {
  if (actor.sokoBotId)
    throw forbidden("A person must approve recurring public SEO work");
  if (input.analysis.sharedBrief || input.analysis.setupGoal)
    throw badRequest("Choose page goals in a one-off check");
  requireSeoAnalysisDispatch();
  const owner = await requireSeoOwner(actor, prisma, true);
  const executor = await requireSeoAnalysisExecutor(actor, input.analysis);
  if (!executor.canSchedule)
    throw conflict(
      "Automatic SEO monitoring is unavailable for this check service",
    );
  const preparedAnalysis = executor.analysis;
  const scope = await resolveSeoScope(actor, input.analysis);
  if (
    input.analysis.scopeId &&
    input.analysis.expectedScopeVersion !== scope.version
  )
    throw conflict(
      "The page group changed. Reload it before scheduling monitoring.",
    );
  const pageUrls = scope.pages.map((page) => page.url);
  validateSeoAnalysis(preparedAnalysis, pageUrls);
  // Each Run sends this packet with its own Analysis id, a UUID of the same length: refuse it now, not at every Run.
  seoTaskPacket(preparedAnalysis, pageUrls, crypto.randomUUID());
  // A retry of a monitor already made replays it in createTaskSchedule: only a new monitor needs the credits.
  const made = await prisma.taskScheduleCreateOperation.findUnique({
    where: {
      workspaceId_operationId: {
        workspaceId: actor.workspaceId,
        operationId: input.operationId,
      },
    },
    select: { schedule: { select: { description: true } } },
  });
  if (!made)
    requireSeoFullAuditPriceApproval(
      preparedAnalysis,
      origin === "cmo-subscription",
    );
  if (!made)
    await requireSeoAnalysisBalance(
      prisma,
      {
        userId: actor.userId,
        organizationId: actor.organizationId,
        projectId: owner.projectId,
      },
      seoAnalysisAdmissionCredits(preparedAnalysis, pageUrls.length),
    );
  const { searchConsolePropertyId, allowLimitedAudit, ...publicAnalysis } =
    preparedAnalysis;
  const approveCoverage =
    origin === "interactive" &&
    publicAnalysis.kind === "audit_full" &&
    (!made ||
      parsePacket(made.schedule.description)?.requiresApprovalRecord === true);
  const access =
    approveCoverage && !made && !allowLimitedAudit
      ? await checkAuditSearchConsole(
          actor,
          scope.pages,
          searchConsolePropertyId,
        )
      : null;
  const analysis = requestSeoAnalysisSchema.parse({
    ...publicAnalysis,
    coworkerId: executor.coworkerId,
    scopeId: undefined,
    expectedScopeVersion: undefined,
    pageIds: scope.pageIds,
    idempotencyKey: "monitor-template",
  });
  const description = seoMonitorDescription({
    ...(actor.owner.kind === "audit"
      ? { version: 2, auditId: actor.owner.id }
      : { version: 1 }),
    ...(approveCoverage && { requiresApprovalRecord: true as const }),
    rule: input.rule,
    scopeVersion: scope.version,
    analysis,
  });
  return createTaskSchedule(
    vars,
    {
      operationId: input.operationId,
      name: `SEO ${analysis.kind.replaceAll("_", " ")}`,
      description,
      projectId: owner.projectId,
      visibility: "PUBLIC",
      assigneeId: analysis.coworkerId,
      rule: {
        ...input.rule,
        targetRunCount: input.rule.targetRunCount ?? undefined,
      },
    },
    {
      origin,
      ...(approveCoverage && {
        requestIdentity: { searchConsolePropertyId, allowLimitedAudit },
        saveApproval: async (tx, scheduleId) => {
          if (made)
            throw conflict("The saved SEO monitor changed. Retry scheduling.");
          const current = await resolveSeoScope(actor, input.analysis, tx);
          if (
            current.version !== scope.version ||
            auditPageSelection(current.pages) !==
              auditPageSelection(scope.pages)
          )
            throw conflict(
              "The selected pages changed. Review the monitor again.",
            );
          await saveMonitorSearchConsoleApproval(
            tx,
            actor,
            scheduleId,
            scope.pageIds,
            scope.version,
            access,
          );
        },
      }),
    },
  );
}

function monitorRunActor(
  schedule: TaskSchedule,
  packet: NonNullable<ReturnType<typeof parsePacket>>,
): SeoActor {
  if (
    !schedule.ownerId ||
    (packet.version === 1 && !schedule.projectId) ||
    schedule.creatorUserId !== schedule.ownerId ||
    schedule.creatorCoworkerId ||
    schedule.creatorSokoBotId ||
    schedule.visibility !== "PUBLIC" ||
    schedule.assigneeId !== packet.analysis.coworkerId ||
    schedule.assigneeSokoBotId ||
    schedule.assigneeUserId ||
    schedule.expr !== packet.rule.expr ||
    schedule.timezone !== packet.rule.timezone ||
    (schedule.intervalDays ?? null) !== (packet.rule.intervalDays ?? null) ||
    // A rule without a step keeps the anchor the schedule wrote; only an every-N-days rule runs from it.
    (packet.rule.anchorAt != null &&
      schedule.anchorAt.getTime() !== Date.parse(packet.rule.anchorAt)) ||
    schedule.endsMode !== packet.rule.endsMode ||
    (schedule.endsOn?.getTime() ?? null) !==
      (packet.rule.endsOn == null ? null : Date.parse(packet.rule.endsOn)) ||
    schedule.targetRunCount !== packet.rule.targetRunCount
  )
    throw forbidden(
      "The SEO monitor no longer matches its approved public blueprint",
    );
  return {
    owner:
      packet.version === 2
        ? { kind: "audit", id: packet.auditId }
        : { kind: "project", id: schedule.projectId! },
    workspaceId: schedule.workspaceId,
    userId: schedule.ownerId,
    organizationId: schedule.organizationId,
  };
}

/** A person approves only this extra Run. Background releases retain their existing plan. */
export async function approveManualSeoRun(
  schedule: TaskSchedule,
  { searchConsolePropertyId, allowLimitedAudit }: CreateTaskScheduleRunRequest,
  origin: "interactive" | "cmo-subscription",
): Promise<ManualSeoRunApproval | undefined> {
  const packet = parsePacket(schedule.description);
  if (packet?.analysis.kind !== "audit_full") {
    if (searchConsolePropertyId || allowLimitedAudit)
      throw badRequest(
        "Search Console coverage applies only to full audit Runs.",
      );
    return undefined;
  }
  const actor = monitorRunActor(schedule, packet);
  if (origin === "cmo-subscription" && !packet.requiresApprovalRecord)
    return origin;
  const owner = await requireSeoOwner(actor, prisma, true);
  if (owner.projectId !== schedule.projectId)
    throw forbidden("The SEO monitor no longer matches its approved context");
  const { pages } = await resolveSeoScope(actor, packet.analysis);
  const saved =
    packet.requiresApprovalRecord &&
    !allowLimitedAudit &&
    !searchConsolePropertyId
      ? await readMonitorSearchConsoleApproval(prisma, actor, schedule.id)
      : undefined;
  // A fresh manual Run can verify the saved property on a new owner-authorized account. Its proof belongs to this Run only.
  const access =
    allowLimitedAudit || saved === null
      ? null
      : await checkAuditSearchConsole(
          actor,
          pages,
          searchConsolePropertyId ?? saved?.propertyId,
        );
  return { pages: pages.map(({ id, url }) => ({ id, url })), access };
}

/**
 * Only the durable planned Run ledger, or a Run now that passed the schedule's write checks, may release this
 * packet. Each Run gets its own request ID.
 */
export async function releaseSeoMonitorRun(
  tx: Prisma.TransactionClient,
  schedule: TaskSchedule,
  runId: string,
  manual = false,
  approval?: ManualSeoRunApproval,
) {
  const packet = parsePacket(schedule.description);
  if (!packet) return null;
  const actor = monitorRunActor(schedule, packet);
  if (
    manual &&
    packet.analysis.kind === "audit_full" &&
    (!approval ||
      (approval === "cmo-subscription" && packet.requiresApprovalRecord))
  )
    throw conflict(
      "Review this full audit in the SEO workspace before Run now.",
    );
  // A Run now Run row is written after its Task, in the same transaction.
  const planned =
    manual ||
    (await tx.taskScheduleRun.findFirst({
      where: {
        id: runId,
        scheduleId: schedule.id,
        state: "PLANNED",
        manual: false,
      },
      select: { id: true },
    }));
  if (!planned)
    throw forbidden(
      "Request a one-off analysis instead of adding an unbudgeted monitor Run",
    );
  // The request seam validates the locked ledger for a Run owed before Project close.
  // Run now retains the normal open-Project gate.
  const owner = await requireSeoOwner(actor, tx, manual);
  if (owner.projectId !== schedule.projectId)
    throw forbidden("The SEO monitor no longer matches its approved context");
  const input = requestSeoAnalysisSchema.parse({
    ...packet.analysis,
    idempotencyKey: `seo-monitor:${schedule.id}:${runId}`,
  });
  const manualApproval = typeof approval === "object" ? approval : undefined;
  const analysis = await requestProjectSeoAnalysisInTransaction(
    actor,
    input,
    tx,
    {},
    {
      frozenScopeVersion: packet.scopeVersion,
      requireScheduledExecutor: true,
      plannedMonitorRun: manual
        ? undefined
        : { scheduleId: schedule.id, runId },
      pages: manualApproval?.pages,
      searchConsoleAccess: manualApproval
        ? manualApproval.access
        : packet.requiresApprovalRecord
          ? await readMonitorSearchConsoleApproval(tx, actor, schedule.id)
          : undefined,
    },
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
  await requireSeoOwner(actor);
  const found: Array<
    Omit<ProjectSeoWorkspace["monitors"][number], "lastRun" | "change">
  > = [];
  let cursor: string | null = null;
  while (found.length < SEO_MONITOR_LIST_LIMIT) {
    const rows: TaskSchedule[] = await prisma.taskSchedule.findMany({
      where: {
        ...(actor.owner.kind === "project"
          ? { projectId: actor.owner.id }
          : {}),
        workspaceId: actor.workspaceId,
        visibility: "PUBLIC",
        description: { startsWith: SEO_MONITOR_MARKER },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SEO_MONITOR_LIST_LIMIT,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    found.push(
      ...rows.flatMap((row) => {
        try {
          const packet = parsePacket(row.description);
          const matchesOwner =
            packet &&
            (actor.owner.kind === "audit"
              ? packet.version === 2 && packet.auditId === actor.owner.id
              : packet.version === 1 && row.projectId === actor.owner.id);
          return matchesOwner
            ? [
                {
                  id: row.id,
                  name: row.name,
                  state: row.state,
                  revision: row.revision,
                  createdAt: row.createdAt.toISOString(),
                  nextRunAt: row.nextRunAt?.toISOString() ?? null,
                  rule: packet.rule,
                  releasedCount: row.releasedCount,
                  pageIds: packet.analysis.pageIds ?? [],
                  scopeVersion: packet.scopeVersion,
                  countryCode: packet.analysis.countryCode,
                  languageCode: packet.analysis.languageCode,
                  devices: packet.analysis.devices,
                  kind: packet.analysis.kind,
                  maxProviderCalls: packet.analysis.maxProviderCalls,
                  isOwner: row.ownerId === actor.userId,
                },
              ]
            : [];
        } catch {
          return [];
        }
      }),
    );
    if (rows.length < SEO_MONITOR_LIST_LIMIT) break;
    cursor = rows.at(-1)!.id;
  }
  const monitors = found.slice(0, SEO_MONITOR_LIST_LIMIT);
  const runs = await readSeoMonitorRuns(
    actor,
    monitors.map((monitor) => monitor.id),
  );
  return monitors.map((monitor) => ({
    ...monitor,
    lastRun: runs.get(monitor.id)?.lastRun ?? null,
    change: runs.get(monitor.id)?.change ?? null,
  }));
}
