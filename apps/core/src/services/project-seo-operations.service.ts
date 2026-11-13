import type { Prisma, ProjectSeoObservation } from "@sokosumi/database";

import { badRequest, conflict, notFound } from "@/helpers/error";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  requireSeoAnalysisDispatch,
  requireSeoAnalysisExecutor,
} from "@/lib/seo/analysis-dispatch";
import {
  requireSeoAnalysisBalance,
  seoAnalysisMaxCredits,
} from "@/lib/seo/analysis-price";
import { seoVisibilityFor } from "@/lib/seo/data-visibility";
import { searchOpportunities } from "@/lib/seo/search-opportunities";
import type {
  RequestSeoAnalysis,
  SeoActor,
} from "@/schemas/project-seo.schema";
import {
  nativeSeoMetricsSchema,
  SEO_MAX_PAGES,
} from "@/schemas/project-seo.schema";

import {
  canReadPrivateSeoMetrics,
  commitSeoMutation,
  normalizeSeoUrl,
  requireLockedSeoOwner,
  requireSeoOwner,
  resolveSeoScope,
  type SeoMutationHooks,
  seoOwnerUnique,
  seoOwnerWhere,
  sha256,
} from "./project-seo-store";
import { requireLockedOpenProject } from "./project-social-connections.service";
import { createTaskForActor } from "./task-domain.service";

async function requireSeoTaskProject(
  actor: SeoActor,
  tx: Prisma.TransactionClient,
) {
  const owner = await requireSeoOwner(actor, tx);
  if (owner.projectId)
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

function selectedModules(input: RequestSeoAnalysis): string[] {
  if (input.kind === "page_check") return ["page.inspect"];
  if (input.kind === "rankings") return ["keyword.refresh"];
  if (input.kind === "links") return ["links.refresh"];
  return input.analyses ?? ["page.inspect"];
}
// The SEO worker refuses a Task packet longer than this (seo-bot MAX_ANALYSIS_REQUEST_CHARS).
export const SEO_MAX_PACKET_CHARS = 32_768;

/** The Task packet the SEO worker reads. Refuse it here when the worker would refuse it. */
export function seoTaskPacket(
  input: RequestSeoAnalysis,
  pageUrls: string[],
  requestId: string,
): Prisma.InputJsonObject {
  const packet: Prisma.InputJsonObject =
    input.kind === "audit_full"
      ? {
          version: 1,
          requestId,
          pageUrls,
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

/** The Task and its frozen request commit together. Retrying never dispatches another paid analysis. */
export async function requestProjectSeoAnalysis(
  actor: SeoActor,
  input: RequestSeoAnalysis,
  hooks: SeoMutationHooks = {},
) {
  return serializableTransaction(
    (tx) => requestProjectSeoAnalysisInTransaction(actor, input, tx, hooks),
    "The analysis request changed. Retry with the same key.",
  );
}

/** Used by the schedule Run ledger so a fresh request and released Task commit together. */
export async function requestProjectSeoAnalysisInTransaction(
  actor: SeoActor,
  input: RequestSeoAnalysis,
  tx: Prisma.TransactionClient,
  hooks: SeoMutationHooks = {},
  frozenScopeVersion?: number,
  requireScheduledExecutor = false,
) {
  requireSeoAnalysisDispatch();
  const requestHash = sha256(JSON.stringify(input));
  await requireLockedSeoOwner(tx, actor);
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
    return commitSeoMutation(tx, previous, hooks);
  }
  const executor = await requireSeoAnalysisExecutor(actor, input, tx);
  if (requireScheduledExecutor && !executor.canSchedule)
    throw conflict(
      "Automatic SEO monitoring is unavailable for this check service",
    );
  input = executor.analysis;
  const coworkerId = executor.coworkerId;
  const scope = await resolveSeoScope(actor, input, tx),
    pageUrls = scope.pages.map((page) => page.url);
  if (input.scopeId && input.expectedScopeVersion !== scope.version)
    throw conflict(
      "The page group changed. Reload it before requesting an analysis.",
    );
  validateSeoAnalysis(input, pageUrls);
  const projectId = await requireSeoTaskProject(actor, tx);
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
  const packet = seoTaskPacket(input, pageUrls, analysis.id);
  // A monitor checks its first Run when it is made. A refused scheduled Run would roll back its release and hold the
  // schedule, so a later short balance pauses that Run's Task at completion instead (OUT_OF_CREDITS).
  if (!requireScheduledExecutor)
    await requireSeoAnalysisBalance(
      tx,
      {
        userId: actor.userId,
        organizationId: actor.organizationId,
        projectId,
      },
      seoAnalysisMaxCredits(input, pageUrls.length),
    );
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
      description: `${input.kind === "audit_full" ? "seo_audit" : "seo_job"}: ${JSON.stringify(packet)}`,
      assigneeId: coworkerId,
      status: "READY",
      visibility: "PUBLIC",
    },
    tx,
  );
  const request: Prisma.InputJsonObject = packet;
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
    if (!action) throw notFound("SEO recommendation not found");
    return { observation, action, evidence: [] as string[] };
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
  return { observation, action, evidence: action.evidence };
}

export async function createProjectSeoActionTask(
  actor: SeoActor,
  input: { observationId: string; actionId: string; idempotencyKey: string },
  hooks: SeoMutationHooks = {},
) {
  return serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    await hooks.authorize?.(tx);
    const previousKey = await tx.projectSeoActionTask.findUnique({
      where: seoOwnerUnique(actor, "idempotencyKey", {
        idempotencyKey: input.idempotencyKey,
      }),
    });
    if (
      previousKey &&
      (previousKey.observationId !== input.observationId ||
        previousKey.actionId !== input.actionId)
    )
      throw conflict(
        "This action key was already used for another recommendation",
      );
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
      return commitSeoMutation(tx, previous, hooks);
    }
    const { observation, action, evidence } = await resolveSeoTaskSource(
      tx,
      actor,
      input,
    );
    // One Task per Search Console opportunity, even after later syncs store new observations.
    const sameOpportunity = evidence.length
      ? await tx.projectSeoActionTask.findFirst({
          where: { ...seoOwnerWhere(actor), actionId: action.id },
        })
      : null;
    if (sameOpportunity) return commitSeoMutation(tx, sameOpportunity, hooks);
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
        description: `Page: ${action.pageUrl}\n\n${action.why}\n\nExpected effect (hypothesis): ${action.expectedEffect}${evidence.length ? `\n\nMeasured evidence:\n${evidence.map((line) => `- ${line}`).join("\n")}` : ""}\n\nSource SEO observation: ${observation.id}\nSource audit Task: ${observation.sourceTaskId ?? "none"}\n\n${evidence.length ? "Compare a later Search Console period before calling this an improvement." : "Implementation needs a fresh check before it is verified."}`,
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
