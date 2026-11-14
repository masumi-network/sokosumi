import type { Prisma } from "@sokosumi/database";
import {
  SEO_EVAL_CAPABILITIES,
  type SokoBotScenario,
} from "@sokosumi/soko-bot";
import { z } from "zod";
import { badRequest } from "@/helpers/error";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import { serializableTransaction } from "@/lib/db/transaction";
import { findSeoAnalysisExecutor } from "@/lib/seo/analysis-dispatch";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { requireSeoOwner, sha256 } from "@/services/project-seo-store";
import type { EvalLaneRecord } from "./eval-lanes.service";

export const SEO_EVAL_HOME_URL = "https://example.org/seo-eval/home";
export const SEO_EVAL_PRICING_URL = "https://example.org/seo-eval/pricing";
const ADDED_PAGE_URL = "https://example.org/seo-eval/docs";
const ADDED_PAGE_LABEL = "SEO eval documentation";
const GROUP_NAME = "SEO eval launch pages";
const KEYWORD = "agent marketplace pricing";
const COMPETITOR_URL = "https://example.com/seo-eval/competitor";
const ACTION_ID = "eval-add-pricing-title";
const CHANGE_TITLE = "Updated pricing page title";
const CHANGE_NOTE =
  "Owner reports a new title. Traffic impact is not measured.";
const FIXTURE_REQUIRED =
  "A registered provider-free SEO eval fixture is required";

export const seoEvalFixtureSchema = z.object({
  version: z.literal(1),
  resultId: z.uuid(),
  caseId: z.string(),
  lane: z.number().int().positive(),
  projectId: z.uuid(),
  homePageId: z.uuid(),
  pricingPageId: z.uuid(),
  occurredAt: z.iso.datetime(),
});
export type SeoEvalFixture = z.infer<typeof seoEvalFixtureSchema>;

export function isSeoEvalCase(caseId: string): boolean {
  return Object.hasOwn(SEO_EVAL_CAPABILITIES, caseId);
}

async function requireLane(
  tx: Prisma.TransactionClient,
  lane: EvalLaneRecord,
  scenario: SokoBotScenario,
  resultId: string,
) {
  const registered = await tx.evalLane.findFirst({
    where: {
      lane: lane.lane,
      userId: lane.userId,
      organizationId: lane.organizationId,
      workspaceId: lane.workspaceId,
      sokoBotId: lane.sokoBotId,
      cusoBotId: lane.cusoBotId,
    },
    select: { world: true },
  });
  const world = z
    .object({ marketingProjectId: z.uuid() })
    .safeParse(registered?.world);
  const result = await tx.evalResult.findFirst({
    where: {
      id: resultId,
      caseId: scenario.id,
      suite: "soko-bot",
      repeat: lane.lane,
      status: { in: ["PENDING", "RUNNING"] },
      run: { status: "RUNNING" },
    },
    select: { state: true, createdAt: true },
  });
  const bot = await tx.sokoBot.findFirst({
    where: {
      id: lane.sokoBotId,
      userId: lane.userId,
      workspaceId: lane.workspaceId,
      projectId: null,
      archivedAt: null,
      deletedAt: null,
      workspace: {
        organizationId: lane.organizationId,
        organization: {
          slug: `sokosumi-evals-${lane.lane}`,
          members: { some: { userId: lane.userId, role: "owner" } },
        },
      },
    },
    select: { id: true },
  });
  if (
    !world.success ||
    !result ||
    !bot ||
    world.data.marketingProjectId !== lane.world.marketingProjectId
  )
    throw badRequest(FIXTURE_REQUIRED);
  const actor: SeoActor = {
    userId: lane.userId,
    workspaceId: lane.workspaceId,
    organizationId: lane.organizationId,
    owner: { kind: "project", id: world.data.marketingProjectId },
  };
  await requireSeoOwner(actor, tx, true);
  if (await findSeoAnalysisExecutor(actor, tx))
    throw badRequest(
      "Provider-free SEO eval lanes must not have an analysis executor",
    );
  const selected = await tx.seoConnection.count({
    where: {
      workspaceId: lane.workspaceId,
      userId: lane.userId,
      status: "ACTIVE",
    },
  });
  const inherited = await tx.sokoBotIntegration.count({
    where: {
      status: "ACTIVE",
      provider: { in: ["google_analytics", "google_search_console"] },
      sokoBot: { workspaceId: lane.workspaceId, userId: lane.userId },
    },
  });
  if (selected || inherited)
    throw badRequest(
      "Provider-free SEO eval lanes must not have native statistics connections",
    );
  return { actor, result };
}

function recommendationPayload(pageUrl: string, occurredAt: string) {
  return publicSeoPayloadSchema.parse({
    version: 1,
    kind: "page_check",
    requestId: null,
    pageUrls: [pageUrl],
    observedAt: occurredAt,
    countryCode: "US",
    languageCode: "en",
    rulebookVersion: "eval-fixture-v1",
    checks: [{ rowId: "title", pageUrl, device: "desktop", result: "fired" }],
    keywords: [],
    competitors: [],
    findings: [
      {
        id: "eval-missing-title",
        pageUrl,
        device: "desktop",
        rowId: "title",
        title: "Fixture pricing page has no title",
        severity: "minor",
        evidence: ["Synthetic public fixture: the title element is empty."],
        sourceRef: "eval-fixture",
        observedAt: occurredAt,
      },
    ],
    actions: [
      {
        id: ACTION_ID,
        pageUrl,
        findingIds: ["eval-missing-title"],
        title: "Add a descriptive pricing page title",
        why: "The fixture page has no title.",
        effort: "low",
        expectedEffect: "A clearer search snippet, not a measured improvement.",
        edit: null,
      },
    ],
    coverage: { checked: 1, skipped: 0, failed: 0 },
    notes: ["Synthetic public eval evidence. No provider or live audit ran."],
  });
}

function fixturePrompt(scenario: SokoBotScenario, fixture: SeoEvalFixture) {
  return `${scenario.prompt}\n\nSaved SEO fixture context (owner-authorized inputs):\n${JSON.stringify(
    {
      projectId: fixture.projectId,
      homePageUrl: SEO_EVAL_HOME_URL,
      pricingPageUrl: SEO_EVAL_PRICING_URL,
      ...(scenario.id === "seo-add-page"
        ? { newPageUrl: ADDED_PAGE_URL, label: ADDED_PAGE_LABEL }
        : {}),
      ...(scenario.id === "seo-save-page-group"
        ? { groupName: GROUP_NAME }
        : {}),
      ...(scenario.id === "seo-save-keyword" ? { keyword: KEYWORD } : {}),
      ...(scenario.id === "seo-confirm-competitor"
        ? { competitorUrl: COMPETITOR_URL }
        : {}),
      ...(scenario.id === "seo-recommendation-task"
        ? { observationId: fixture.resultId, actionId: ACTION_ID }
        : {}),
      ...(scenario.id === "seo-record-page-change"
        ? {
            occurredAt: fixture.occurredAt,
            title: CHANGE_TITLE,
            note: CHANGE_NOTE,
          }
        : {}),
    },
  )}\nRead actual page IDs and evidence with get_seo_workspace. Use a fresh idempotencyKey for this request and retain it for retries. Do not use a provider-backed SEO tool.`;
}

/** Prepares real records before starting the model; a retry keeps the same fixture. */
export async function prepareSeoEvalCase(
  lane: EvalLaneRecord,
  scenario: SokoBotScenario,
  resultId: string,
): Promise<{ scenario: SokoBotScenario; state: Record<string, unknown> }> {
  if (!isSeoEvalCase(scenario.id)) return { scenario, state: {} };
  const fixture = await serializableTransaction(async (tx) => {
    const { actor, result } = await requireLane(tx, lane, scenario, resultId);
    const state = z.record(z.string(), z.unknown()).safeParse(result.state);
    const previous = z
      .object({ seoFixture: seoEvalFixtureSchema })
      .safeParse(result.state);
    if (
      state.success &&
      Object.hasOwn(state.data, "seoFixture") &&
      !previous.success
    )
      throw badRequest(FIXTURE_REQUIRED);
    if (previous.success) {
      const saved = previous.data.seoFixture;
      if (
        saved.resultId !== resultId ||
        saved.caseId !== scenario.id ||
        saved.lane !== lane.lane ||
        saved.projectId !== actor.owner.id ||
        saved.occurredAt !== result.createdAt.toISOString()
      )
        throw badRequest(FIXTURE_REQUIRED);
      const pages = await tx.projectSeoPage.count({
        where: {
          projectId: actor.owner.id,
          OR: [
            { id: saved.homePageId, url: SEO_EVAL_HOME_URL },
            { id: saved.pricingPageId, url: SEO_EVAL_PRICING_URL },
          ],
        },
      });
      if (pages !== 2) throw badRequest(FIXTURE_REQUIRED);
      return saved;
    }
    const pages: string[] = [];
    for (const [url, label] of [
      [SEO_EVAL_HOME_URL, "SEO eval home"],
      [SEO_EVAL_PRICING_URL, "SEO eval pricing"],
    ]) {
      const page = await tx.projectSeoPage.upsert({
        where: { projectId_url: { projectId: actor.owner.id, url } },
        create: {
          projectId: actor.owner.id,
          url,
          label,
          relationship: "primary",
        },
        update: { label, relationship: "primary", relatedToPageId: null },
        select: { id: true },
      });
      pages.push(page.id);
    }
    // Only named fixture choices are reset. Historical turns and public observations remain.
    if (scenario.id === "seo-add-page")
      await tx.projectSeoPage.deleteMany({
        where: { projectId: actor.owner.id, url: ADDED_PAGE_URL },
      });
    if (scenario.id === "seo-save-page-group")
      await tx.projectSeoScope.deleteMany({
        where: { projectId: actor.owner.id, name: GROUP_NAME },
      });
    if (scenario.id === "seo-save-keyword")
      await tx.projectSeoKeyword.deleteMany({
        where: {
          projectId: actor.owner.id,
          keywordKey: KEYWORD,
          countryCode: "US",
          languageCode: "en",
        },
      });
    if (scenario.id === "seo-confirm-competitor")
      await tx.projectSeoCompetitor.deleteMany({
        where: { projectId: actor.owner.id, url: COMPETITOR_URL },
      });
    const saved = seoEvalFixtureSchema.parse({
      version: 1,
      resultId,
      caseId: scenario.id,
      lane: lane.lane,
      projectId: actor.owner.id,
      homePageId: pages[0],
      pricingPageId: pages[1],
      occurredAt: result.createdAt.toISOString(),
    });
    if (scenario.id === "seo-recommendation-task") {
      const payload = recommendationPayload(
        SEO_EVAL_PRICING_URL,
        saved.occurredAt,
      );
      await tx.projectSeoObservation.create({
        data: {
          id: resultId,
          projectId: actor.owner.id,
          kind: "page_check",
          source: "eval_fixture",
          sourceKey: `eval:${resultId}`,
          ownerId: null,
          pageIds: [saved.pricingPageId],
          artifactHash: sha256(JSON.stringify(payload)),
          payload,
          observedAt: result.createdAt,
        },
      });
    }
    await tx.evalResult.update({
      where: { id: resultId },
      data: {
        state: {
          ...(state.success ? state.data : {}),
          seoFixture: saved,
        } as Prisma.InputJsonObject,
      },
    });
    return saved;
  }, "SEO eval fixture changed. Retry the case.");
  return {
    scenario: { ...scenario, prompt: fixturePrompt(scenario, fixture) },
    state: { seoFixture: fixture },
  };
}

export const SEO_EVAL_EXPECTED = {
  addedPageUrl: ADDED_PAGE_URL,
  addedPageLabel: ADDED_PAGE_LABEL,
  groupName: GROUP_NAME,
  keyword: KEYWORD,
  competitorUrl: COMPETITOR_URL,
  actionId: ACTION_ID,
  changeTitle: CHANGE_TITLE,
  changeNote: CHANGE_NOTE,
} as const;
