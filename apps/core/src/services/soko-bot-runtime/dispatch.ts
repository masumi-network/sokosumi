import { isSokoBotSeoCapability } from "@sokosumi/soko-bot";
import {
  evalCoworkerRefusal,
  isEvalWorkspace,
  simulatedEvalTool,
} from "@/lib/evals/eval-guard";
import {
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { dispatchChatTools } from "./dispatch-chat";
import { dispatchFilesTools } from "./dispatch-files";
import { dispatchIntegrationsTools } from "./dispatch-integrations";
import { dispatchNewsletterTools } from "./dispatch-newsletter";
import { dispatchOtherTools } from "./dispatch-other";
import { dispatchSchedulesTools } from "./dispatch-schedules";
import { dispatchSocialTools } from "./dispatch-social";
import { dispatchTablesTools } from "./dispatch-tables";
import { dispatchTasksTools } from "./dispatch-tasks";
import { type RuntimeOperations } from "./operations";

export async function executeAuthorizedTool(
  runtime: RuntimeOperations,
  raw: ExecuteSokoBotToolInput,
): Promise<unknown> {
  const authorized = await runtime.authorize(raw);

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
    case "create_project":
    case "update_project":
    case "refresh_context":
    case "find_coworkers":
    case "update_memory":
    case "save_brand_brain":
    case "save_strategy":
    case "report_update":
    case "evaluate_with_jev":
    case "search_exa":
      return dispatchOtherTools(runtime, input, authorized);
    case "list_tables":
    case "read_table":
    case "create_table":
    case "write_table_rows":
    case "update_table_columns":
      return dispatchTablesTools(runtime, input, authorized);
    case "create_task":
    case "update_task":
    case "archive_task":
    case "assign_task":
    case "get_task_status":
    case "list_tasks":
    case "update_assigned_task":
    case "reply_to_task":
    case "link_tasks":
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
  }
}
