import {
  SOKO_BOT_SEO_INPUT_SCHEMAS,
  type SokoBotSeoCapability,
} from "@sokosumi/soko-bot";
import { badRequest } from "@/helpers/error";
import { isEvalWorkspace } from "@/lib/evals/eval-guard";

import {
  addSeoPageSchema,
  createSeoScopeSchema,
  type ProjectSeoWorkspace,
  requestSeoAnalysisSchema,
  type SeoActor,
  saveSeoCompetitorSchema,
  saveSeoKeywordSchema,
  seoWorkspaceQuerySchema,
  updateSeoScopeSchema,
} from "@/schemas/project-seo.schema";
import { syncProjectSeoStatisticsSchema } from "@/schemas/project-seo-statistics.schema";
import {
  addProjectSeoPage,
  createProjectSeoScope,
  getProjectSeoWorkspace,
  saveProjectSeoCompetitor,
  saveProjectSeoKeyword,
  updateProjectSeoScope,
} from "@/services/project-seo.service";
import { importProjectSeoAudit } from "@/services/project-seo-import.service";
import {
  createProjectSeoActionTask,
  requestProjectSeoAnalysis,
} from "@/services/project-seo-operations.service";
import { recordProjectSeoPageChange } from "@/services/project-seo-page-changes.service";
import {
  listProjectSeoStatisticsProperties,
  syncProjectSeoStatistics,
} from "@/services/project-seo-statistics.service";
import type { SeoMutationHooks } from "@/services/project-seo-store";

const PROVIDER_BACKED_SEO_TOOLS = new Set<SokoBotSeoCapability>([
  "import_seo_audit",
  "request_seo_analysis",
  "sync_seo_statistics",
]);

type SiteSpeedRow = NonNullable<
  ProjectSeoWorkspace["siteSpeed"]
>["rows"][number];

/** A measurement as Soko Bot reads it: values, statuses and codes. A lab insight's text is the worker's: it is left out. */
function botSpeedDevice({
  pageUrl,
  testedUrl,
  device,
  lab,
  field,
}: SiteSpeedRow["devices"][number]) {
  return {
    pageUrl,
    testedUrl,
    device,
    lab:
      lab.status === "measured"
        ? {
            status: lab.status,
            median: lab.median,
            runs: lab.runs,
            ok: lab.ok,
            ...(lab.pageSpeed && {
              pageSpeed: {
                scores: lab.pageSpeed.scores,
                measuredAt: lab.pageSpeed.measuredAt,
              },
            }),
          }
        : { status: lab.status },
    field:
      field.status === "measured"
        ? {
            status: field.status,
            level: field.level,
            url: field.url,
            p75: field.p75,
            period: field.period,
            history: field.history,
          }
        : { status: field.status },
  };
}

/**
 * The workspace as Soko Bot reads it. The speed table holds the SEO worker's free text (a row's `why` and
 * `group`, a lab insight's sentences): it can carry instructions for a model, so only the SEO page gets it.
 * Each field of a row is named here: a new field of the table does not reach Soko Bot by default.
 */
async function botSeoWorkspace(
  ...args: Parameters<typeof getProjectSeoWorkspace>
) {
  const workspace = await getProjectSeoWorkspace(...args);
  if (!workspace.siteSpeed) return workspace;
  return {
    ...workspace,
    siteSpeed: {
      ...workspace.siteSpeed,
      rows: workspace.siteSpeed.rows.map((row) => ({
        url: row.url,
        audited: row.audited,
        cause: row.cause,
        tier: row.tier,
        check: row.check,
        devices: row.devices.map(botSpeedDevice),
      })),
    },
  };
}

/** Chat and the SEO page share authorization, validation and durable operations. */
export async function runSeoTool(
  capability: SokoBotSeoCapability,
  rawInput: unknown,
  actor: SeoActor,
  hooks: SeoMutationHooks,
  replay = false,
): Promise<unknown> {
  const parsed = SOKO_BOT_SEO_INPUT_SCHEMAS[capability].parse(rawInput);
  const { projectId, ...fields } = parsed;
  if (actor.owner.kind !== "project" || projectId !== actor.owner.id)
    throw new Error("SEO Project mismatch");
  if (
    PROVIDER_BACKED_SEO_TOOLS.has(capability) &&
    actor.sokoBotId &&
    (await isEvalWorkspace(actor.workspaceId))
  )
    throw badRequest(
      "Provider-backed SEO tools are not available in provider-free eval cases",
    );
  const link = `/seo?projectId=${encodeURIComponent(projectId)}&view=project`;
  if (capability === "get_seo_workspace") {
    return {
      ...(await botSeoWorkspace(actor, seoWorkspaceQuerySchema.parse(fields))),
      link,
    };
  }
  if (capability === "list_seo_statistics_properties") {
    const input =
      SOKO_BOT_SEO_INPUT_SCHEMAS.list_seo_statistics_properties.parse(parsed);
    return {
      ...(await listProjectSeoStatisticsProperties(actor, input.provider)),
      link,
    };
  }
  // A receipt proves the write. Replays reauthorize and read current state,
  // rather than returning private evidence cached before a permission change.
  if (replay)
    return { ...(await botSeoWorkspace(actor)), link, replayed: true };
  let result: unknown;
  switch (capability) {
    case "record_seo_page_change":
      result = await recordProjectSeoPageChange(actor, fields, hooks);
      break;
    case "add_seo_page":
      result = await addProjectSeoPage(
        actor,
        addSeoPageSchema.parse(fields),
        hooks,
      );
      break;
    case "save_seo_scope": {
      const { scopeId, ...input } =
        SOKO_BOT_SEO_INPUT_SCHEMAS.save_seo_scope.parse(parsed);
      const { projectId: _projectId, ...scope } = input;
      result = scopeId
        ? await updateProjectSeoScope(
            actor,
            scopeId,
            updateSeoScopeSchema.parse(scope),
            hooks,
          )
        : await createProjectSeoScope(
            actor,
            createSeoScopeSchema.parse({
              name: scope.name,
              pageIds: scope.pageIds,
            }),
            hooks,
          );
      break;
    }
    case "save_seo_keyword":
      result = await saveProjectSeoKeyword(
        actor,
        saveSeoKeywordSchema.parse(fields),
        hooks,
      );
      break;
    case "save_seo_competitor":
      result = await saveProjectSeoCompetitor(
        actor,
        saveSeoCompetitorSchema.parse(fields),
        hooks,
      );
      break;
    case "import_seo_audit": {
      const { taskId, fileId } =
        SOKO_BOT_SEO_INPUT_SCHEMAS.import_seo_audit.parse(parsed);
      result = await importProjectSeoAudit(actor, { taskId, fileId }, hooks);
      break;
    }
    case "request_seo_analysis":
      result = await requestProjectSeoAnalysis(
        actor,
        requestSeoAnalysisSchema.parse(fields),
        hooks,
      );
      break;
    case "create_seo_action_task": {
      const { observationId, actionId, idempotencyKey } =
        SOKO_BOT_SEO_INPUT_SCHEMAS.create_seo_action_task.parse(parsed);
      result = await createProjectSeoActionTask(
        actor,
        { observationId, actionId, idempotencyKey },
        hooks,
      );
      break;
    }
    case "sync_seo_statistics":
      return {
        ...(await syncProjectSeoStatistics(
          actor,
          syncProjectSeoStatisticsSchema.parse(fields),
          hooks,
        )),
        link,
      };
  }
  const identity =
    result && typeof result === "object"
      ? (result as { id?: string; taskId?: string })
      : {};
  return {
    ...(await botSeoWorkspace(actor)),
    link,
    result: {
      id: identity.id,
      ...(identity.taskId
        ? {
            taskId: identity.taskId,
            reference: { kind: "task", id: identity.taskId },
          }
        : {}),
    },
  };
}
