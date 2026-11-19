import type {
  AddProjectSeoPageRequest,
  CreateProjectSeoActionTaskRequest,
  CreateProjectSeoMonitorRequest,
  CreateProjectSeoScopeRequest,
  CreateTaskScheduleRunRequest,
  ImportProjectSeoAuditRequest,
  RecordProjectSeoPageChangeRequest,
  RequestProjectSeoAnalysisRequest,
  SaveProjectSeoBrandTermsRequest,
  SaveProjectSeoCompetitorRequest,
  SaveProjectSeoKeywordRequest,
  SyncProjectSeoStatisticsRequest,
  TaskScheduleRuleReplacement,
  UpdateProjectSeoScopeRequest,
} from "@sokosumi/core-client";

/** Web intents carry generated request DTOs. Core owns their validation and authority. */
export type SeoCommand =
  | { kind: "add_page"; body: AddProjectSeoPageRequest }
  | { kind: "create_scope"; body: CreateProjectSeoScopeRequest }
  | {
      kind: "update_scope";
      scopeId: string;
      body: UpdateProjectSeoScopeRequest;
    }
  | { kind: "import_audit"; body: ImportProjectSeoAuditRequest }
  | { kind: "record_page_change"; body: RecordProjectSeoPageChangeRequest }
  | { kind: "save_brand_terms"; body: SaveProjectSeoBrandTermsRequest }
  | { kind: "create_monitor"; body: CreateProjectSeoMonitorRequest }
  | {
      kind: "monitor_state";
      monitorId: string;
      action: "pause" | "resume" | "end";
    }
  | ({
      kind: "monitor_run_now";
      monitorId: string;
    } & CreateTaskScheduleRunRequest)
  | {
      kind: "monitor_update";
      monitorId: string;
      expectedRevision: number;
      rule: TaskScheduleRuleReplacement;
    }
  | { kind: "request_analysis"; body: RequestProjectSeoAnalysisRequest }
  | { kind: "save_keyword"; body: SaveProjectSeoKeywordRequest }
  | { kind: "save_competitor"; body: SaveProjectSeoCompetitorRequest }
  | { kind: "create_action_task"; body: CreateProjectSeoActionTaskRequest }
  | { kind: "sync_statistics"; body: SyncProjectSeoStatisticsRequest };

/** A Google or goal decision belongs to the session that reviewed it. Older shared brief reviews identify the viewer. */
export function seoReviewIdentity(command: SeoCommand) {
  if (command.kind === "monitor_run_now") return "session";
  const analysis =
    command.kind === "request_analysis"
      ? command.body
      : command.kind === "create_monitor"
        ? command.body?.analysis
        : undefined;
  if (analysis?.kind === "audit_full" || analysis?.setupGoal) return "session";
  return analysis?.sharedBrief ? "viewer" : null;
}
