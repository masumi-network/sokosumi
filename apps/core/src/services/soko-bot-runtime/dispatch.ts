import { isSokoBotSeoCapability } from "@sokosumi/soko-bot";
import {
  evalCoworkerRefusal,
  isEvalWorkspace,
  simulatedEvalTool,
} from "@/lib/evals/eval-guard";
import { withModelCallTurn } from "@/lib/soko-bot/model-calls";
import {
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { executeCmoRead } from "./cmo-reads";
import { executeCmoSeoTool } from "./cmo-seo";
import { dispatchAnnouncementTools } from "./dispatch-announcements";
import { dispatchChatTools } from "./dispatch-chat";
import { dispatchFilesTools } from "./dispatch-files";
import { dispatchIntegrationsTools } from "./dispatch-integrations";
import { dispatchMcpTools } from "./dispatch-mcp";
import { dispatchNewsletterTools } from "./dispatch-newsletter";
import { dispatchOtherTools } from "./dispatch-other";
import { dispatchSchedulesTools } from "./dispatch-schedules";
import { dispatchSocialTools } from "./dispatch-social";
import { dispatchTablesTools } from "./dispatch-tables";
import { dispatchTaskInterestTools } from "./dispatch-task-interest";
import { dispatchTasksTools } from "./dispatch-tasks";
import { type RuntimeOperations } from "./operations";

export async function executeAuthorizedTool(
  runtime: RuntimeOperations,
  raw: ExecuteSokoBotToolInput,
): Promise<unknown> {
  const authorized = await runtime.authorize(raw);
  // Check models and Jev calls a tool makes are recorded on this turn.
  return withModelCallTurn(authorized.turn.id, () =>
    executeTool(runtime, raw, authorized),
  );
}

async function executeTool(
  runtime: RuntimeOperations,
  raw: ExecuteSokoBotToolInput,
  authorized: Awaited<ReturnType<RuntimeOperations["authorize"]>>,
): Promise<unknown> {
  const input = {
    ...raw,
    input: await runtime.resolveTaskIds(authorized, raw.input),
  };

  if (await isEvalWorkspace(authorized.turn.workspaceId)) {
    const refusal = await evalCoworkerRefusal(
      authorized.turn.workspaceId,
      input.input,
    );
    if (refusal) throw new SokoBotRuntimeValidationError(refusal);
    const simulated = simulatedEvalTool(input.capability, input.input);
    if (simulated) return simulated;
  }

  if (isSokoBotSeoCapability(input.capability))
    return runtime.executeSeoTool(input, authorized);
  switch (input.capability) {
    case "newsletter_draft_issue":
    case "get_newsletter":
    case "list_newsletter_issues":
    case "get_newsletter_issue":
    case "get_newsletter_analytics":
    case "list_newsletter_subscribers":
    case "preview_newsletter_issue":
    case "preview_newsletter_signup_form":
    case "create_newsletter_issue":
    case "update_newsletter_issue":
    case "delete_newsletter_issue":
    case "submit_newsletter_issue":
    case "update_newsletter_settings":
    case "add_newsletter_subscriber":
    case "import_newsletter_subscribers":
    case "add_newsletter_subscribers_from_contacts":
    case "update_newsletter_subscriber":
    case "remove_newsletter_subscriber":
      return dispatchNewsletterTools(runtime, input, authorized);
    case "list_announcements":
    case "save_announcement":
    case "publish_announcement":
      return dispatchAnnouncementTools(runtime, input, authorized);
    case "list_project_social_accounts":
    case "get_posting_instructions":
    case "list_social_posts":
    case "list_social_post_statistics":
    case "refresh_social_post_statistics":
    case "list_social_account_statistics":
    case "refresh_social_account_statistics":
    case "get_social_post":
    case "create_social_post":
    case "update_social_post":
    case "update_social_posts":
    case "schedule_social_post":
    case "cancel_social_post":
    case "publish_social_post":
    case "list_ad_accounts":
    case "list_ad_campaigns":
    case "find_ad_targeting":
    case "get_market_keywords":
    case "create_ad_campaign":
    case "get_ad_campaign":
    case "update_ad_campaign":
    case "edit_ad_campaign":
    case "delete_ad_campaign":
    case "read_memory":
    case "list_social_comments":
    case "handle_social_comment":
    case "read_writing_skill":
    case "find_style_references":
    case "read_social_profile":
      return dispatchSocialTools(runtime, input, authorized);
    case "wait_for":
    case "start_background_run":
    case "list_background_runs":
    case "stop_background_run":
    case "manage_reminder":
    case "list_schedules":
    case "create_schedule":
    case "update_schedule":
    case "delete_schedule":
      return dispatchSchedulesTools(runtime, input, authorized);
    case "search_contacts":
    case "count_contacts":
    case "search_companies":
    case "get_company":
    case "update_company":
    case "bulk_update_contacts":
    case "get_contact":
    case "list_contact_lists":
    case "find_contact_duplicates":
    case "upsert_contact":
    case "update_contact":
    case "log_contact_interaction":
    case "merge_contacts":
    case "manage_contact_lists":
    case "find_people":
    case "enrich_contact":
    case "export_contacts_to_table":
    case "fundraising_pipeline":
    case "investor_warm_paths":
    case "find_investors":
    case "create_project":
    case "update_project":
    case "refresh_context":
    case "find_coworkers":
    case "update_memory":
    case "save_brand_brain":
    case "save_strategy":
    case "report_update":
    case "write_month_pieces":
    case "write_strategy":
    case "evaluate_with_jev":
    case "search_exa":
    case "check_competitors":
    case "save_competitor_feed":
      return dispatchOtherTools(runtime, input, authorized);
    case "read_calendar":
    case "read_strategy":
    case "read_brand_brain":
    case "read_report":
    case "read_competitor_moves":
      return executeCmoRead(input, authorized);
    case "read_seo":
    case "research_keywords":
    case "research_competitor_keywords":
    case "check_search_rankings":
    case "save_seo_suggestions":
      return executeCmoSeoTool(input, authorized);
    case "list_tables":
    case "read_table":
    case "create_table":
    case "write_table_rows":
    case "update_table_columns":
      return dispatchTablesTools(runtime, input, authorized);
    case "list_followed_tasks":
    case "stop_following_task":
      return dispatchTaskInterestTools(runtime, input, authorized);
    case "create_task":
    case "update_task":
    case "archive_task":
    case "assign_task":
    case "get_task_status":
    case "list_tasks":
    case "update_assigned_task":
    case "reply_to_task":
    case "link_tasks":
    case "set_task_parent":
    case "find_agents":
    case "get_agent_input_schema":
    case "hire_agent":
    case "get_job_status":
    case "provide_job_input":
      return dispatchTasksTools(runtime, input, authorized);
    case "list_chats":
    case "read_chat":
    case "open_direct_chat":
    case "ask_coworker":
    case "send_message":
    case "list_recipients":
    case "preview_result":
    case "post_chat":
      return dispatchChatTools(runtime, input, authorized);
    case "list_files":
    case "upload_file":
    case "generate_voiceover":
    case "move_file":
    case "delete_file":
    case "list_skills":
    case "install_skill":
    case "remove_skill":
    case "generate_image":
    case "get_image":
    case "generate_video":
    case "get_video":
    case "generate_talking_video":
    case "read_file":
      return dispatchFilesTools(runtime, input, authorized);
    case "list_integrations":
    case "find_integrations":
    case "search_inbox":
    case "read_email":
    case "update_emails":
    case "draft_email":
    case "save_email_attachment":
    case "send_email_draft":
    case "list_integration_tools":
    case "read_integration_tool":
    case "run_integration_tool":
    case "list_calendar_events":
      return dispatchIntegrationsTools(runtime, input, authorized);
    case "list_mcp_tools":
    case "read_mcp_tool":
    case "run_mcp_tool":
      return dispatchMcpTools(input, authorized);
  }
  throw new SokoBotRuntimeValidationError(
    `No Core handler for tool: ${input.capability}`,
  );
}
