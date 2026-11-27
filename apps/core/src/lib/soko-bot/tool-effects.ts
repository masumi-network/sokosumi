import {
  SOKO_BOT_CMO_READ_CAPABILITIES,
  SOKO_BOT_DIRECT_READ_CAPABILITIES,
  SOKO_BOT_SEO_WRITE_CAPABILITIES,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
} from "@sokosumi/soko-bot";

/**
 * Pure, Prisma/Hono-free capability effect classification shared by Core's
 * receipt/authority checks, Core's tool-error classifier, and the standalone
 * sandbox runner bundle (`soko-bot-runner.mjs`).
 */

/** These effects cannot be repeated safely after an ambiguous transport failure. */
export const EXTERNAL_EFFECT_CAPABILITIES = new Set([
  "hire_agent",
  "provide_job_input",
  "run_integration_tool",
  "run_mcp_tool",
  "upload_file",
  "publish_social_post",
  // Creates a campaign at Google; never repeated after an unclear failure.
  "create_ad_campaign",
  // Change or delete a campaign at the provider; never repeated after an unclear failure.
  "update_ad_campaign",
  "edit_ad_campaign",
  "delete_ad_campaign",
  // A paid provider call: never repeated after an unclear failure.
  "find_investors",
  "generate_image",
  "generate_video",
  "generate_talking_video",
  "generate_voiceover",
  "draft_email",
  "send_email_draft",
  "save_email_attachment",
]);

/**
 * Input-aware external-effect check shared by receipt tracking, OwnerAuthority
 * enforcement, and lost-response tool-error classification. Covers
 * always-effectful tools plus `investor_warm_paths` when `research: true`
 * incurs paid Exa spend and writes portfolio data.
 */
export function isExternalEffectToolCall(
  capability: string,
  rawInput: unknown,
): boolean {
  if (EXTERNAL_EFFECT_CAPABILITIES.has(capability)) return true;
  return (
    capability === "investor_warm_paths" &&
    SOKO_BOT_TOOL_INPUT_SCHEMAS.investor_warm_paths.safeParse(rawInput).data
      ?.research === true
  );
}

export const ACTION_CAPABILITIES = new Set([
  ...SOKO_BOT_SEO_WRITE_CAPABILITIES,
  "newsletter_draft_issue",
  "create_newsletter_issue",
  "update_newsletter_issue",
  "delete_newsletter_issue",
  "submit_newsletter_issue",
  "update_newsletter_settings",
  "save_announcement",
  "publish_announcement",
  "add_newsletter_subscriber",
  "import_newsletter_subscribers",
  "add_newsletter_subscribers_from_contacts",
  "update_newsletter_subscriber",
  "remove_newsletter_subscriber",
  ...EXTERNAL_EFFECT_CAPABILITIES,
  "create_task",
  "create_table",
  "write_table_rows",
  "update_table_columns",
  "update_task",
  "archive_task",
  "assign_task",
  "reply_to_task",
  "update_assigned_task",
  "link_tasks",
  "set_task_parent",
  "stop_following_task",
  "post_chat",
  "open_direct_chat",
  "ask_coworker",
  "send_message",
  "upsert_contact",
  "update_contact",
  "log_contact_interaction",
  "merge_contacts",
  "manage_contact_lists",
  "update_company",
  "bulk_update_contacts",
  "export_contacts_to_table",
  "find_people",
  "enrich_contact",
  "create_project",
  "update_project",
  "create_schedule",
  "update_schedule",
  "delete_schedule",
  "save_task_schedule",
  "delete_task_schedule",
  "update_memory",
  "manage_reminder",
  "create_social_post",
  "update_social_post",
  "schedule_social_post",
  "cancel_social_post",
  "move_file",
  "delete_file",
  "update_emails",
  "install_skill",
  "remove_skill",
]);

/** Warm paths have an action receipt only when the owner requests research. */
export const ACTION_RECEIPT_CAPABILITIES = [
  ...ACTION_CAPABILITIES,
  "investor_warm_paths",
];

/**
 * Tools in `SOKO_BOT_DIRECT_READ_CAPABILITIES` that are NOT unconditionally
 * free read-only: either input-dependent paid research (`investor_warm_paths`),
 * paid LLM calls (`evaluate_with_jev`), or provider refreshes that write state.
 */
const NON_FREE_OR_INPUT_DEPENDENT_READS: ReadonlySet<string> = new Set([
  "investor_warm_paths",
  "evaluate_with_jev",
  "refresh_social_post_statistics",
  "refresh_social_account_statistics",
]);

/**
 * Explicit allowlist of pure read-only, non-paid capabilities that are safe to
 * classify as `transient` (retry once) when a response is lost or times out.
 * Anything outside this allowlist — writes, paid research (`find_investors`,
 * `find_people`, `search_exa`, `web_search`, `research_keywords`, ...), media
 * jobs, hires, ads, or unknown future capabilities — fails closed to
 * `uncertain` so the model reads back state first instead of retrying blindly.
 */
const FREE_READ_ONLY_CAPABILITIES: ReadonlySet<string> = new Set(
  [
    ...SOKO_BOT_DIRECT_READ_CAPABILITIES,
    ...SOKO_BOT_CMO_READ_CAPABILITIES,
    "find_coworkers",
    "get_agent_input_schema",
    "list_social_comments",
    "read_seo",
    "read_skill",
    "read_writing_skill",
    "find_style_references",
    "read_social_profile",
    "web_fetch",
    "workspace_read",
    "workspace_list",
    "workspace_search",
  ].filter(
    (capability) =>
      !ACTION_CAPABILITIES.has(capability) &&
      !NON_FREE_OR_INPUT_DEPENDENT_READS.has(capability),
  ),
);

/**
 * Input-aware check for whether a tool call is a pure, non-paid read that is
 * safe to retry once after an ambiguous transport failure or timeout.
 *
 * `investor_warm_paths` is retry-safe ONLY for valid non-research reads
 * (`research !== true`); `research: true` or missing/unparseable input fails
 * closed so paid research is never retried blindly.
 */
export function isRetrySafeReadToolCall(
  capability: string,
  rawInput?: unknown,
): boolean {
  if (FREE_READ_ONLY_CAPABILITIES.has(capability)) return true;
  if (capability === "investor_warm_paths") {
    const parsed =
      SOKO_BOT_TOOL_INPUT_SCHEMAS.investor_warm_paths.safeParse(rawInput);
    return parsed.success && !isExternalEffectToolCall(capability, rawInput);
  }
  return false;
}

/**
 * True when a tool call mutates state, incurs paid provider/credit spend, or
 * cannot be proven to be a free read-only call for the given input.
 * Used on BOTH Core and sandbox runner paths so lost responses classify as
 * `uncertain` (`retryable: false`) rather than `transient`.
 */
export function isMutatingOrPaidToolCall(
  capability: string,
  rawInput?: unknown,
): boolean {
  return !isRetrySafeReadToolCall(capability, rawInput);
}
