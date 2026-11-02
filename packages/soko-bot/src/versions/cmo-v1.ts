import { SOKO_BOT_CMO_CAPABILITIES } from "../policy.js";
import type { SokoBotVersion } from "./types.js";
import { v19 } from "./v19.js";
import { v25 } from "./v25.js";

/**
 * Cuso, the AI CMO behind cmo.xyz. v25's operating contract (chained work,
 * no splitting a request into questions) on v19's model, with a marketing
 * persona, the CMO skills, and the tools a marketer needs. Like v27 he writes
 * scripts for repetitive tool work, follows hired Agent Jobs through and asks
 * a Coworker before committing work to them. Personal mail and calendar stay
 * out: Cuso works for the business, not the inbox.
 */
export const cmoV1: SokoBotVersion = {
  id: "cmo-v1",
  profile: "cmo",
  name: "cmo-v1 · Cuso, the AI CMO",
  createdAt: "2026-10-01",
  model: v19.model,
  inferenceRegion: v19.inferenceRegion,
  summary:
    "Cuso: learns the brand into a Brand Brain, plans a month of marketing, drafts and schedules social posts with images, and improves the plan every week.",
  skills: [
    "cmo-brand-brain",
    "cmo-strategy",
    "cmo-production",
    "cmo-daily-watch",
    "cmo-measurement",
    "social-posts",
    "long-work",
    "chained-work",
    "code-tools",
    "agent-jobs",
    "ask-coworker-first",
  ],
  capabilities: [
    "refresh_context",
    "read_memory",
    "update_memory",
    "find_coworkers",
    "create_task",
    "update_task",
    "assign_task",
    "get_task_status",
    "list_tasks",
    "reply_to_task",
    "link_tasks",
    "find_agents",
    "get_agent_input_schema",
    "hire_agent",
    "get_job_status",
    "provide_job_input",
    "list_schedules",
    "create_schedule",
    "update_schedule",
    "manage_reminder",
    "delete_schedule",
    "list_chats",
    "read_chat",
    "post_chat",
    "ask_coworker",
    "list_files",
    "read_file",
    "upload_file",
    "generate_image",
    "get_image",
    "generate_video",
    "get_video",
    "list_tables",
    "read_table",
    "create_table",
    "write_table_rows",
    "list_project_social_accounts",
    "list_social_posts",
    "get_social_post",
    "create_social_post",
    "update_social_post",
    "schedule_social_post",
    "cancel_social_post",
    "publish_social_post",
    // Google Analytics, Search Console and Shopify, when the owner connects them.
    "list_integration_tools",
    "run_integration_tool",
    "web_search",
    "web_fetch",
    "workspace_read",
    "workspace_write",
    "workspace_list",
    "workspace_search",
    "update_plan",
    "run_subagent",
    "bash",
    "start_background_run",
    "list_background_runs",
    "stop_background_run",
    ...SOKO_BOT_CMO_CAPABILITIES,
  ],
  systemPrompt: `${v25.systemPrompt}

# You are Cuso

You are Cuso, the owner's CMO. You run their marketing end to end: you learn the brand, plan the month, write and design the content, publish it where you may, measure what works and improve the plan. You work for the business, not for the owner's personal inbox.

- The owner's words win. A spontaneous request ("post this today", "change the plan") is done in the same turn, and the strategy is updated to match.
- Everything you publish must sound like the brand in the Brand Brain. If it would sound like generic AI marketing, rewrite it.
- Show your work concretely: the post text, the image, the date and channel. Link what you created.
- Be honest about numbers and about what you could not do.
- After you act on something the founder asked for in chat (a post, an announcement, a change to the plan), always call report_update kind request with what you did, then answer in one or two sentences. The card is what they look for.
- Plan first, ask later. A change to the plan never waits for a connected account or a missing detail: put it in the calendar on the channel the strategy already uses, then mention what is missing in one line. Ask only when you cannot make a sensible choice yourself.
- Speak the founder's language, not Sokosumi's: "connect your social accounts", never internal names such as Project Social, routes or tools.`,
};
