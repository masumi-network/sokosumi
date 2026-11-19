import type {
  Prisma,
  ProjectSeoActionTask,
  ProjectSeoObservation,
} from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
  SEO_FULL_AUDIT_MAX_PROVIDER_USD,
  seasonalUpdateHasPassed,
  seoTaskDescription,
} from "@sokosumi/utils";

import { badRequest, conflict, notFound } from "@/helpers/error";
import {
  publicDecisionAction,
  readPublicSeoDecisions,
} from "@/helpers/project-seo-decisions";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import { seasonalPayloadActions } from "@/helpers/project-seo-seasonal";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  requireSeoAnalysisDispatch,
  requireSeoAnalysisExecutor,
} from "@/lib/seo/analysis-dispatch";
import {
  requireSeoAnalysisBalance,
  requireSeoFullAuditPriceApproval,
  seoAnalysisAdmissionCredits,
} from "@/lib/seo/analysis-price";
import { fullAuditBillingContext } from "@/lib/seo/audit-settlement";
import { seoVisibilityFor } from "@/lib/seo/data-visibility";
import { seoPageComparisonKey } from "@/lib/seo/related-page-selection";
import { searchOpportunities } from "@/lib/seo/search-opportunities";
import { selectedModules, seoTaskSummary } from "@/lib/seo/seo-task-summary";
import type {
  RequestSeoAnalysis,
  SeoActor,
} from "@/schemas/project-seo.schema";
import { SEO_MAX_PAGES } from "@/schemas/project-seo.schema";
import { nativeSeoMetricsSchema } from "@/schemas/project-seo-native-metrics.schema";
import { SEO_MAX_PACKET_CHARS } from "@/schemas/seo-task-pages.schema";
import { requireNoActiveSeoAnalysis } from "./project-seo-analysis-concurrency";
import {
  type PlannedSeoMonitorRun,
  requirePlannedSeoMonitorRun,
} from "./project-seo-monitor-release";
import {
  canReadPrivateSeoMetrics,
  commitSeoMutation,
  normalizeSeoUrl,
  requireLockedSeoOwner,
  requireSeoOwner,
  resolveSeoScope,
  type SeoMutationHooks,
  seoLinkedTaskWhere,
  seoOwnerUnique,
  seoOwnerWhere,
  sha256,
} from "./project-seo-store";
import { requireLockedOpenProject } from "./project-social-connections.service";
import {
  type PublicPageGoals,
  pinSeoAuditBrief,
} from "./seo-audit-brief-dispatch";
import {
  type AuditSearchConsoleProof,
  assertAuditSearchConsoleCurrent,
  checkAuditSearchConsole,
} from "./seo-audit-search-console";
import { createTaskForActor } from "./task-domain.service";

async function requireSeoTaskProject(
  actor: SeoActor,
  tx: Prisma.TransactionClient,
  requireOpen = true,
) {
  const owner = await requireSeoOwner(actor, tx);
  if (owner.projectId && requireOpen)
    await requireLockedOpenProject(tx, {
      projectId: owner.projectId,
      workspaceId: actor.workspaceId,
    });
  return owner.projectId;
}

// Same disallowed priced operators as the public worker request protocol.
const PRICED_SEARCH_OPERATOR =
  /(?:^|[\s("'+-])(?:allinanchor|allintext|allintitle|allinurl|cache|define|definition|filetype|id|inanchor|info|intext|intitle|inurl|link|site):/i;
const keywordIdentity = (value: string) =>
  value.normalize("NFC").toLowerCase().trim().replace(/\s+/g, " ");

/** The Task packet the SEO worker reads. Refuse it here when the worker would refuse it. */
export function seoTaskPacket(
  input: RequestSeoAnalysis,
  pageUrls: string[],
  requestId: string,
  context?: PublicPageGoals,
): Prisma.InputJsonObject {
  if (
    Boolean(input.sharedBrief) !== Boolean(context) ||
    (context && input.kind !== "audit_full")
  )
    throw badRequest("Choose shared page goals for one full audit only");
  const price =
    input.fullAuditPrice ??
    (input.fullAuditCredits === undefined
      ? undefined
      : { kind: "fixed", credits: input.fullAuditCredits });
  if (
    input.kind === "audit_full" &&
    price &&
    new Set(pageUrls.map(seoPageComparisonKey)).size !== pageUrls.length
  )
    throw badRequest(
      "Select each audit page once, including equivalent URL encodings",
    );
  const packet: Prisma.InputJsonObject =
    input.kind === "audit_full"
      ? {
          version: context ? 2 : 1,
          ...(context ? { context } : {}),
          requestId,
          pageUrls,
          ...(price ? { price, inspectRelated: true } : {}),
          ...(input.keywords[0] ? { keyword: input.keywords[0] } : {}),
          countryCode: input.countryCode,
          languageCode: input.languageCode,
          ...(input.fullAuditLimits ? { limits: input.fullAuditLimits } : {}),
        }
      : {
          version: 1,
          requestId,
          kind: input.kind,
          pageUrls,
          competitorUrls: input.competitorUrls.map(normalizeSeoUrl),
          keywords: input.keywords,
          countryCode: input.countryCode,
          languageCode: input.languageCode,
          devices: input.devices,
          ...(input.analyses ? { analyses: input.analyses } : {}),
          budget: {
            maxPages: pageUrls.length,
            maxKeywords: input.keywords.length,
            maxCompetitors: input.competitorUrls.length,
            maxProviderCalls: input.maxProviderCalls,
          },
        };
  if (JSON.stringify(packet).length > SEO_MAX_PACKET_CHARS)
    throw badRequest(
      "The SEO request is too long for the worker. Use shorter URLs or fewer pages, keywords or competitors",
    );
  return packet;
}

export function validateSeoAnalysis(
  input: RequestSeoAnalysis,
  pageUrls: string[],
): void {
  if (
    (input.allowLimitedAudit || input.searchConsolePropertyId) &&
    input.kind !== "audit_full"
  )
    throw badRequest("Search Console audit choices apply only to a full audit");
  if (!pageUrls.length || pageUrls.length > SEO_MAX_PAGES)
    throw badRequest("Select between one and ten pages for an analysis");
  if (new Set(input.devices).size !== input.devices.length)
    throw badRequest("Select each device once");
  if (
    new Set(input.keywords.map(keywordIdentity)).size !== input.keywords.length
  )
    throw badRequest("Select each keyword once");
  if (input.keywords.some((word) => PRICED_SEARCH_OPERATOR.test(word)))
    throw badRequest("Remove the search operator from the keyword");
  if (input.analyses && new Set(input.analyses).size !== input.analyses.length)
    throw badRequest("Select each analysis once");
  if (
    new Set(input.competitorUrls.map(normalizeSeoUrl)).size !==
    input.competitorUrls.length
  )
    throw badRequest("Select each competitor once");
  if (input.kind === "audit_full") {
    if (
      (input.fullAuditPrice || input.fullAuditCredits !== undefined) &&
      (input.fullAuditLimits?.usd ?? 0) > SEO_FULL_AUDIT_MAX_PROVIDER_USD
    )
      throw badRequest(
        "The full-audit data budget exceeds the provider allowance",
      );
    if (input.analyses || input.competitorUrls.length)
      throw badRequest("Full audits cannot use focused analysis options");
    if (input.keywords.length > 1)
      throw badRequest("A full audit accepts one optional target keyword");
    if (input.devices.length !== 2)
      throw badRequest("A full audit checks both mobile and desktop");
    if (pageUrls.length === 1 && input.fullAuditLimits)
      throw badRequest(
        "A single-page full audit uses the worker's page deadline; site limits require related pages",
      );
    if (new Set(pageUrls.map((url) => new URL(url).host)).size !== 1)
      throw badRequest("A full related-page audit uses pages on the same host");
    return;
  }
  if (input.fullAuditPrice || input.fullAuditCredits !== undefined)
    throw badRequest("A full-audit price applies only to full audits");
  if (input.fullAuditLimits)
    throw badRequest("Full-audit limits apply only to full audits");
  const modules = selectedModules(input);
  if (input.kind !== "audit_lite" && input.analyses)
    throw badRequest("Choose individual checks only for Audit Lite");
  if (modules.includes("keyword.refresh") && !input.keywords.length)
    throw badRequest("Add keywords for a ranking refresh");
  if (!modules.includes("links.refresh") && input.competitorUrls.length)
    throw badRequest("Competitor targets require a links refresh");
  const calls =
    (modules.includes("keyword.refresh")
      ? input.keywords.length * input.devices.length
      : 0) +
    (modules.includes("links.refresh")
      ? pageUrls.length + input.competitorUrls.length
      : 0);
  if (calls > input.maxProviderCalls)
    throw badRequest("The selected checks exceed the provider-call budget");
  if (
    input.competitorUrls.some((url) => pageUrls.includes(normalizeSeoUrl(url)))
  )
    throw badRequest("An owned page cannot also be a competitor target");
}

/** Check the same scope, executor, idempotency key and spending limit before Google and again before dispatch. */
async function prepareSeoAnalysis(
  actor: SeoActor,
  input: RequestSeoAnalysis,
  tx: Prisma.TransactionClient,
  hooks: SeoMutationHooks,
  requireScheduledExecutor = false,
  plannedMonitorRun?: PlannedSeoMonitorRun,
) {
  requireSeoAnalysisDispatch();
  const humanOneOff =
    !actor.sokoBotId && !plannedMonitorRun && !requireScheduledExecutor;
  if (input.sharedBrief && (!humanOneOff || input.kind !== "audit_full"))
    throw badRequest(
      "Choose the goals to share for each full audit in your own session",
    );
  if (
    input.setupGoal &&
    (!humanOneOff ||
      (input.kind !== "audit_full" && input.kind !== "page_check"))
  )
    throw badRequest("Set a page goal for a one-off check in your own session");
  if (actor.sokoBotId && input.allowLimitedAudit)
    throw badRequest("Approve a limited audit in your own SEO workspace");
  const requestHash = sha256(JSON.stringify(input));
  await requireLockedSeoOwner(tx, actor, !plannedMonitorRun);
  if (plannedMonitorRun)
    await requirePlannedSeoMonitorRun(tx, actor, plannedMonitorRun);
  await hooks.authorize?.(tx);
  const previous = await tx.projectSeoAnalysis.findUnique({
    where: seoOwnerUnique(actor, "idempotencyKey", {
      idempotencyKey: input.idempotencyKey,
    }),
  });
  if (previous) {
    if (
      previous.requestHash !== requestHash ||
      previous.requestedBy !== actor.userId
    )
      throw conflict("This analysis key was already used for another request");
    return { previous };
  }
  if (!requireScheduledExecutor) requireSeoFullAuditPriceApproval(input);
  await requireNoActiveSeoAnalysis(tx, actor);
  const executor = await requireSeoAnalysisExecutor(actor, input, tx);
  if (requireScheduledExecutor && !executor.canSchedule)
    throw conflict(
      "Automatic SEO monitoring is unavailable for this check service",
    );
  input = executor.analysis;
  const coworkerId = executor.coworkerId;
  const scope = await resolveSeoScope(actor, input, tx);
  const pageUrls = scope.pages.map((page) => page.url);
  if (input.scopeId && input.expectedScopeVersion !== scope.version)
    throw conflict(
      "The page group changed. Reload it before requesting an analysis.",
    );
  validateSeoAnalysis(input, pageUrls);
  const projectId = await requireSeoTaskProject(actor, tx, !plannedMonitorRun);
  // A monitor checks its first Run when it is made. Recheck at every dispatch: a later short balance must leave
  // the scheduled Run planned for a top-up, rather than spend provider money before reaching OUT_OF_CREDITS.
  await requireSeoAnalysisBalance(
    tx,
    {
      userId: actor.userId,
      organizationId: actor.organizationId,
      projectId,
    },
    seoAnalysisAdmissionCredits(input, pageUrls.length),
  );
  return {
    input,
    scope,
    pageUrls,
    projectId,
    coworkerId,
    requestHash,
    humanOneOff,
  };
}

type AuditPage = { id: string; url: string };

export function auditPageSelection(pages: AuditPage[]) {
  return JSON.stringify(
    pages
      .map(({ id, url }) => [id, url] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

const ANALYSIS_RETRY = "The analysis request changed. Retry with the same key.";

/** The Task and its frozen request commit together. Retrying never dispatches another paid analysis. */
export async function requestProjectSeoAnalysis(
  actor: SeoActor,
  input: RequestSeoAnalysis,
  hooks: SeoMutationHooks = {},
) {
  if (input.kind !== "audit_full" || input.allowLimitedAudit)
    return serializableTransaction(
      (tx) => requestProjectSeoAnalysisInTransaction(actor, input, tx, hooks),
      ANALYSIS_RETRY,
    );

  const ready = await serializableTransaction(async (tx) => {
    const prepared = await prepareSeoAnalysis(actor, input, tx, hooks);
    if (prepared.previous)
      return { replay: await commitSeoMutation(tx, prepared.previous, hooks) };
    if (!(await canReadPrivateSeoMetrics(actor, tx)))
      throw conflict(
        "Open the SEO workspace to review Search Console coverage before starting a full audit.",
      );
    return { pages: prepared.scope.pages.map(({ id, url }) => ({ id, url })) };
  }, ANALYSIS_RETRY);
  if (ready.replay) return ready.replay;
  const proof = await checkAuditSearchConsole(
    actor,
    ready.pages,
    input.searchConsolePropertyId,
  );
  return serializableTransaction(
    (tx) =>
      requestProjectSeoAnalysisInTransaction(actor, input, tx, hooks, {
        searchConsoleAccess: proof,
        pages: ready.pages,
      }),
    ANALYSIS_RETRY,
  );
}

/** Used by the schedule Run ledger so a fresh request and released Task commit together. */
export async function requestProjectSeoAnalysisInTransaction(
  actor: SeoActor,
  requestInput: RequestSeoAnalysis,
  tx: Prisma.TransactionClient,
  hooks: SeoMutationHooks = {},
  options: {
    searchConsoleAccess?: AuditSearchConsoleProof | null;
    pages?: AuditPage[];
    frozenScopeVersion?: number;
    requireScheduledExecutor?: boolean;
    plannedMonitorRun?: PlannedSeoMonitorRun;
  } = {},
) {
  const { frozenScopeVersion, requireScheduledExecutor, plannedMonitorRun } =
    options;
  const prepared = await prepareSeoAnalysis(
    actor,
    requestInput,
    tx,
    hooks,
    requireScheduledExecutor,
    plannedMonitorRun,
  );
  if (prepared.previous) return commitSeoMutation(tx, prepared.previous, hooks);
  const {
    input,
    scope,
    pageUrls,
    projectId,
    coworkerId,
    requestHash,
    humanOneOff,
  } = prepared;
  const access = input.allowLimitedAudit ? null : options.searchConsoleAccess;
  if (
    input.kind === "audit_full" &&
    !requireScheduledExecutor &&
    access === undefined
  )
    throw conflict("Check Search Console before starting this audit.", {
      kind: CORE_API_ERROR_KINDS.SEO_GSC_UNAVAILABLE,
    });
  if (
    options.pages &&
    auditPageSelection(options.pages) !== auditPageSelection(scope.pages)
  )
    throw conflict(
      "The selected audit pages changed. Review them before starting.",
    );
  if (access) {
    if (!(await canReadPrivateSeoMetrics(actor, tx)))
      throw conflict(
        "Open the SEO workspace to review Search Console coverage before starting a full audit.",
      );
    await assertAuditSearchConsoleCurrent(actor, access, tx);
  }
  const initialRequest: Prisma.InputJsonObject = {
    pageUrls,
    countryCode: input.countryCode,
    languageCode: input.languageCode,
    keywords: input.keywords,
    devices: input.devices,
  };
  const analysis = await tx.projectSeoAnalysis.create({
    data: {
      ...seoOwnerWhere(actor),
      idempotencyKey: input.idempotencyKey,
      requestHash,
      kind: input.kind,
      pageIds: scope.pageIds,
      scopeVersion: frozenScopeVersion ?? scope.version,
      request: initialRequest,
      requestedBy: actor.userId,
    },
  });
  const context =
    humanOneOff && (input.kind === "audit_full" || input.setupGoal)
      ? await pinSeoAuditBrief(
          tx,
          actor,
          analysis.id,
          scope.pages,
          input.sharedBrief,
          input.setupGoal,
        )
      : undefined;
  const packet = seoTaskPacket(input, pageUrls, analysis.id, context);
  const task = await createTaskForActor(
    {
      actor: actor.sokoBotId
        ? { kind: "soko_bot", sokoBotId: actor.sokoBotId }
        : { kind: "user", userId: actor.userId },
      ownerId: actor.userId,
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      projectId,
      name: `SEO ${input.kind.replaceAll("_", " ")}`,
      description: seoTaskDescription(
        seoTaskSummary(
          input,
          pageUrls,
          input.competitorUrls.map(normalizeSeoUrl),
        ),
        input.kind === "audit_full" ? "seo_audit" : "seo_job",
        packet,
      ),
      assigneeId: coworkerId,
      status: "READY",
      visibility: "PUBLIC",
    },
    tx,
  );
  const request: Prisma.InputJsonObject = {
    ...packet,
    ...(access !== undefined && {
      searchConsoleAccess: access && { ...access },
    }),
    ...(input.fullAuditPrice && {
      fullAuditBillingContext: fullAuditBillingContext(task),
    }),
  };
  const result = await tx.projectSeoAnalysis.update({
    where: { id: analysis.id },
    data: {
      taskId: task.id,
      request,
      failureReason:
        task.status === "GRANT_PENDING"
          ? "The source Task awaits Workspace Vendor approval"
          : null,
    },
  });
  return commitSeoMutation(tx, result, hooks);
}

/** A private observation is a Task source only for an actor who may read its metrics. */
async function canReadSeoMetricsSource(
  tx: Prisma.TransactionClient,
  actor: SeoActor,
  observation: ProjectSeoObservation | null,
): Promise<boolean> {
  return (
    observation?.kind === "metrics" &&
    observation.visibility === seoVisibilityFor(actor) &&
    !!(actor.organizationId || observation.ownerId === actor.userId) &&
    (await canReadPrivateSeoMetrics(actor, tx))
  );
}

/**
 * A Task source is a public report action, or an opportunity recomputed from a
 * stored Search Console observation the actor may read. Client text is never used.
 */
async function resolveSeoTaskSource(
  tx: Prisma.TransactionClient,
  actor: SeoActor,
  input: { observationId: string; actionId: string },
) {
  const observation = await tx.projectSeoObservation.findFirst({
    where: { id: input.observationId, ...seoOwnerWhere(actor) },
  });
  if (observation && observation.ownerId === null) {
    const parsed = publicSeoPayloadSchema.safeParse(observation.payload);
    if (!parsed.success)
      throw badRequest(
        "The source observation is not a supported public report",
      );
    const action = parsed.data.actions.find((row) => row.id === input.actionId);
    if (action)
      return {
        observation,
        action,
        evidence: [] as string[],
        decision: undefined,
      };
    const data = parsed.data;
    const strategy =
      observation.kind === "audit_full" &&
      data.kind === "audit_full" &&
      readPublicSeoDecisions(
        data.strategyDecisions,
        data.pageUrls,
        data.decisionSources,
      )
        ?.map((d) =>
          publicDecisionAction(d, data.countryCode, data.languageCode),
        )
        .find((d) => d.id === input.actionId);
    const seasonal =
      !strategy && observation.kind === "audit_full"
        ? seasonalPayloadActions(data).find(
            (row) => row.action.id === input.actionId,
          )
        : undefined;
    if (seasonal)
      return {
        observation,
        action: seasonal.action,
        evidence: seasonal.action.evidence,
        seasonalIdea: seasonal.idea,
        decision: undefined,
      };
    if (!strategy) throw notFound("SEO recommendation not found");
    return {
      observation,
      action: strategy,
      evidence: strategy.evidence,
      decision: strategy.decision,
    };
  }
  if (!observation || !(await canReadSeoMetricsSource(tx, actor, observation)))
    throw notFound("SEO observation not found");
  const parsed = nativeSeoMetricsSchema.safeParse(observation.payload);
  if (!parsed.success || parsed.data.provider !== "search_console")
    throw badRequest("The source observation has no Search Console rows");
  const action = searchOpportunities({
    propertyId: parsed.data.propertyId,
    from: parsed.data.from,
    to: parsed.data.to,
    rows: parsed.data.queries?.rows ?? [],
  }).find((row) => row.id === input.actionId);
  if (!action) throw notFound("SEO recommendation not found");
  return {
    observation,
    action,
    evidence: action.evidence,
    decision: undefined,
  };
}

export async function createProjectSeoActionTask(
  actor: SeoActor,
  input: { observationId: string; actionId: string; idempotencyKey: string },
  hooks: SeoMutationHooks = {},
) {
  return serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    await hooks.authorize?.(tx);
    const existingTask = async (link: ProjectSeoActionTask) => {
      const ownerAccess = await canReadPrivateSeoMetrics(actor, tx);
      const visible = await tx.task.findFirst({
        where: { id: link.taskId, ...seoLinkedTaskWhere(actor, ownerAccess) },
        select: { id: true },
      });
      if (!visible) throw notFound("SEO recommendation Task not found");
      if (
        link.idempotencyKey === input.idempotencyKey &&
        (link.observationId !== input.observationId ||
          link.actionId !== input.actionId)
      )
        throw conflict(
          "This action key was already used for another recommendation",
        );
      return commitSeoMutation(tx, link, hooks);
    };
    const previousKey = await tx.projectSeoActionTask.findUnique({
      where: seoOwnerUnique(actor, "idempotencyKey", {
        idempotencyKey: input.idempotencyKey,
      }),
    });
    const previous =
      previousKey ??
      (await tx.projectSeoActionTask.findUnique({
        where: seoOwnerUnique(actor, "observationId_actionId", {
          observationId: input.observationId,
          actionId: input.actionId,
        }),
      }));
    if (previous) {
      // A link to a private Search Console opportunity is returned only to a reader of its metrics.
      const source = await tx.projectSeoObservation.findFirst({
        where: { id: previous.observationId, ...seoOwnerWhere(actor) },
      });
      if (
        source?.ownerId !== null &&
        !(await canReadSeoMetricsSource(tx, actor, source ?? null))
      )
        throw notFound("SEO observation not found");
      return existingTask(previous);
    }
    const { observation, action, evidence, decision, seasonalIdea } =
      await resolveSeoTaskSource(tx, actor, input);
    // Stable opportunity IDs refer to the same work across later audits and Search Console syncs.
    const sameOpportunity = evidence.length
      ? await tx.projectSeoActionTask.findFirst({
          where: { ...seoOwnerWhere(actor), actionId: action.id },
        })
      : null;
    if (sameOpportunity) return existingTask(sameOpportunity);
    if (seasonalIdea && seasonalUpdateHasPassed(seasonalIdea, new Date()))
      throw conflict(
        "This seasonal window has passed. Run a new audit to find the next opportunity.",
      );
    const proposedEdit = action.edit
      ? `\n\nProposed edit:\n${JSON.stringify(action.edit, null, 2)}`
      : "";
    const task = await createTaskForActor(
      {
        actor: actor.sokoBotId
          ? { kind: "soko_bot", sokoBotId: actor.sokoBotId }
          : { kind: "user", userId: actor.userId },
        ownerId: actor.userId,
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        projectId: await requireSeoTaskProject(actor, tx),
        name: action.title,
        description: `Page: ${action.pageUrl}\n\n${action.why}\n\n${decision ? `Alternative: ${decision.alternative}\n\nNext check: ${decision.nextCheck}` : `Expected effect (hypothesis): ${action.expectedEffect}`}${proposedEdit}${evidence.length ? `\n\nMeasured evidence:\n${evidence.map((line) => `- ${line}`).join("\n")}` : ""}\n\nSource SEO observation: ${observation.id}\nSource audit Task: ${observation.sourceTaskId ?? "none"}\n\n${!decision && !seasonalIdea && evidence.length ? "Compare a later Search Console period before calling this an improvement." : "Implementation needs a fresh check before it is verified."}`,
        status: "DRAFT",
        visibility: "PUBLIC",
      },
      tx,
    );
    const link = await tx.projectSeoActionTask.create({
      data: {
        ...seoOwnerWhere(actor),
        observationId: observation.id,
        actionId: action.id,
        taskId: task.id,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return commitSeoMutation(tx, link, hooks);
  }, "The recommendation Task changed. Retry with the same key.");
}
