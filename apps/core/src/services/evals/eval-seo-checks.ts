import {
  type evaluateScenario,
  type ScenarioCheck,
  SEO_EVAL_CAPABILITIES,
} from "@sokosumi/soko-bot";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import { seoPageChangePayloadSchema } from "@/schemas/project-seo.schema";
import type { EvalLaneRecord } from "./eval-lanes.service";
import {
  isSeoEvalCase,
  SEO_EVAL_EXPECTED,
  SEO_EVAL_HOME_URL,
  SEO_EVAL_PRICING_URL,
  type SeoEvalFixture,
  seoEvalFixtureSchema,
} from "./eval-seo-fixtures";

const stateSchema = z.object({ seoFixture: seoEvalFixtureSchema });
const storedId = z.object({ result: z.object({ id: z.uuid() }) });
const workspacePages = z.object({
  pages: z.array(z.object({ id: z.uuid(), url: z.string() })),
});
const NO_EFFECT_TOOLS = [
  "refresh_context",
  "update_plan",
  "preview_result",
  "read_memory",
];
const capabilityFor = (caseId: string) =>
  SEO_EVAL_CAPABILITIES[caseId as keyof typeof SEO_EVAL_CAPABILITIES];

function check(label: string, pass: boolean, actual: string): ScenarioCheck {
  return { label, pass, actual };
}

async function registeredFixture(
  lane: EvalLaneRecord,
  caseId: string,
  state: unknown,
) {
  const parsed = stateSchema.safeParse(state);
  if (!parsed.success) return null;
  const fixture = parsed.data.seoFixture;
  if (
    fixture.caseId !== caseId ||
    fixture.lane !== lane.lane ||
    fixture.projectId !== lane.world.marketingProjectId
  )
    return null;
  const registered = await prisma.evalLane.findFirst({
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
  const result = await prisma.evalResult.findFirst({
    where: {
      id: fixture.resultId,
      caseId,
      suite: "soko-bot",
      repeat: lane.lane,
      status: { in: ["PENDING", "RUNNING"] },
      run: { status: "RUNNING" },
    },
    select: { state: true },
  });
  const saved = stateSchema.safeParse(result?.state);
  if (
    !world.success ||
    world.data.marketingProjectId !== fixture.projectId ||
    !saved.success ||
    JSON.stringify(saved.data.seoFixture) !== JSON.stringify(fixture)
  )
    return null;
  const project = await prisma.project.findFirst({
    where: { id: fixture.projectId, workspaceId: lane.workspaceId },
    select: { id: true },
  });
  return project ? fixture : null;
}

async function storedPostcondition(
  caseId: string,
  fixture: SeoEvalFixture,
  id: string,
  lane: EvalLaneRecord,
) {
  const where = { id, projectId: fixture.projectId, auditId: null };
  switch (caseId) {
    case "seo-add-page": {
      const page = await prisma.projectSeoPage.findFirst({ where });
      return (
        page?.url === SEO_EVAL_EXPECTED.addedPageUrl &&
        page.label === SEO_EVAL_EXPECTED.addedPageLabel &&
        page.relationship === "related" &&
        page.relatedToPageId === fixture.homePageId
      );
    }
    case "seo-save-page-group": {
      const group = await prisma.projectSeoScope.findFirst({ where });
      return (
        group?.name === SEO_EVAL_EXPECTED.groupName &&
        group.pageIds.length === 2 &&
        new Set(group.pageIds).size === 2 &&
        group.pageIds.includes(fixture.homePageId) &&
        group.pageIds.includes(fixture.pricingPageId)
      );
    }
    case "seo-save-keyword": {
      const keyword = await prisma.projectSeoKeyword.findFirst({ where });
      return (
        keyword?.keyword === SEO_EVAL_EXPECTED.keyword &&
        keyword.countryCode === "US" &&
        keyword.languageCode === "en" &&
        keyword.priority === "high" &&
        keyword.saved &&
        keyword.pageId === fixture.pricingPageId
      );
    }
    case "seo-confirm-competitor": {
      const competitor = await prisma.projectSeoCompetitor.findFirst({ where });
      return (
        competitor?.url === SEO_EVAL_EXPECTED.competitorUrl &&
        competitor.confirmed
      );
    }
    case "seo-recommendation-task": {
      const link = await prisma.projectSeoActionTask.findFirst({ where });
      if (
        link?.observationId !== fixture.resultId ||
        link.actionId !== SEO_EVAL_EXPECTED.actionId
      )
        return false;
      const task = await prisma.task.findFirst({
        where: {
          id: link.taskId,
          workspaceId: lane.workspaceId,
          projectId: fixture.projectId,
        },
      });
      return (
        task?.status === "DRAFT" &&
        !task.assigneeId &&
        !task.assigneeUserId &&
        !task.assigneeSokoBotId &&
        !!task.description?.includes(fixture.resultId)
      );
    }
    case "seo-record-page-change": {
      const observation = await prisma.projectSeoObservation.findFirst({
        where,
      });
      const payload = seoPageChangePayloadSchema.safeParse(
        observation?.payload,
      );
      return (
        observation?.kind === "page_change" &&
        observation.pageIds.length === 1 &&
        observation.pageIds[0] === fixture.pricingPageId &&
        payload.success &&
        payload.data.occurredAt === fixture.occurredAt &&
        payload.data.title === SEO_EVAL_EXPECTED.changeTitle &&
        payload.data.note === SEO_EVAL_EXPECTED.changeNote &&
        payload.data.recordedBy === lane.userId
      );
    }
    default:
      return false;
  }
}

/** A tool name alone cannot pass: check its real result and the persisted scoped record. */
export async function seoEvalChecks(
  scenarioId: string,
  lane: EvalLaneRecord,
  turn: Pick<Parameters<typeof evaluateScenario>[1], "toolCalls">,
  state: unknown,
): Promise<ScenarioCheck[]> {
  if (!isSeoEvalCase(scenarioId)) return [];
  const fixture = await registeredFixture(lane, scenarioId, state);
  if (!fixture)
    return [
      check(
        "SEO fixture belongs to this active registered lane",
        false,
        "Missing or mismatched persisted fixture",
      ),
    ];
  const capability = capabilityFor(scenarioId);
  const allowed = new Set([
    capability,
    "get_seo_workspace",
    ...NO_EFFECT_TOOLS,
  ]);
  const unexpected = turn.toolCalls.filter(
    (call) => !allowed.has(call.capability),
  );
  const completed = turn.toolCalls.filter(
    (call) => call.capability === capability && call.status === "COMPLETED",
  );
  const callsUseProject = turn.toolCalls
    .filter(
      (call) =>
        call.capability === capability ||
        call.capability === "get_seo_workspace",
    )
    .every(
      (call) =>
        z
          .object({ projectId: z.literal(fixture.projectId) })
          .safeParse(call.input).success,
    );
  const checks = [
    check(
      "Only the requested SEO operation and safe reads",
      unexpected.length === 0,
      unexpected.map((call) => call.capability).join(", ") ||
        "No external boundary or unrelated mutation called",
    ),
    check(
      "SEO calls use the selected Project",
      callsUseProject && completed.length > 0,
      fixture.projectId,
    ),
  ];
  if (scenarioId === "seo-workspace-read") {
    const read = completed.some((call) => {
      const pages = workspacePages.safeParse(call.result);
      return (
        pages.success &&
        pages.data.pages.some(
          (page) =>
            page.id === fixture.homePageId && page.url === SEO_EVAL_HOME_URL,
        ) &&
        pages.data.pages.some(
          (page) =>
            page.id === fixture.pricingPageId &&
            page.url === SEO_EVAL_PRICING_URL,
        )
      );
    });
    checks.push(
      check(
        "Reads the two real saved SEO pages",
        read,
        read
          ? "Both saved page IDs and URLs returned"
          : "Saved pages absent from successful read",
      ),
    );
  } else if (scenarioId === "seo-statistics-disconnected") {
    const disconnected = completed.some(
      (call) =>
        z
          .object({
            provider: z.literal("search_console"),
            status: z.literal("not_connected"),
            properties: z.array(z.unknown()).length(0),
          })
          .safeParse(call.result).success &&
        z
          .object({ provider: z.literal("search_console") })
          .safeParse(call.input).success,
    );
    checks.push(
      check(
        "Reports the real disconnected native statistics path",
        disconnected,
        disconnected
          ? "not_connected with zero properties"
          : "No verified disconnected property result",
      ),
    );
  } else {
    const ids = [
      ...new Set(
        completed.flatMap((call) => {
          const parsed = storedId.safeParse(call.result);
          return parsed.success ? [parsed.data.result.id] : [];
        }),
      ),
    ];
    const persisted =
      ids.length === 1 &&
      (await storedPostcondition(scenarioId, fixture, ids[0]!, lane));
    checks.push(
      check(
        "One real scoped SEO effect matches the request",
        persisted,
        ids.length ? ids.join(", ") : "No stored result ID",
      ),
    );
  }
  return checks;
}
