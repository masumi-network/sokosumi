import {
  SOKO_BOT_SEO_INPUT_SCHEMAS,
  type SokoBotSeoCapability,
} from "@sokosumi/soko-bot";

import {
  addSeoPageSchema,
  createSeoScopeSchema,
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
  if (projectId !== actor.projectId) throw new Error("SEO Project mismatch");
  const link = `/seo?projectId=${encodeURIComponent(projectId)}`;
  if (capability === "get_seo_workspace") {
    return {
      ...(await getProjectSeoWorkspace(
        actor,
        seoWorkspaceQuerySchema.parse(fields),
      )),
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
    return { ...(await getProjectSeoWorkspace(actor)), link, replayed: true };
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
    ...(await getProjectSeoWorkspace(actor)),
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
