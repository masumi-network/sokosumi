import type { SokoBotCapability } from "./policy.js";

/**
 * Tools whose effect leaves Sokosumi, reaches another person, or runs later
 * without the taint. Once a turn has read the open web or run a shell command,
 * Core refuses these and the bot has to ask the owner first: a fetched page
 * must not be able to send mail, brief a Coworker, or queue either for a
 * later, clean turn.
 */
export const SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES = [
  "request_seo_analysis",
  "hire_agent",
  // Mail leaves the owner's mailbox; a page the bot read must not send it.
  "send_email_draft",
  "update_emails",
  // A skill is instructions the bot follows from then on; a page it read
  // must not be able to install one.
  "install_skill",
  "provide_job_input",
  "run_integration_tool",
  // Not run_mcp_tool: its dispatcher applies a stricter rule of its own (the
  // owner's turn, and nothing untrusted but that same server; ADR 0074).
  "upload_file",
  // Deleting is for good; a page the bot read must not pick what goes.
  "delete_file",
  // Spends credits, and its prompt is the kind of thing a page can inject.
  "generate_image",
  "newsletter_draft_issue",
  "create_newsletter_issue",
  "update_newsletter_issue",
  "delete_newsletter_issue",
  "submit_newsletter_issue",
  "update_newsletter_settings",
  // Subscribing emails people a confirmation; a page must not pick who.
  "add_newsletter_subscriber",
  "import_newsletter_subscribers",
  "add_newsletter_subscribers_from_contacts",
  "update_newsletter_subscriber",
  "remove_newsletter_subscriber",
  "generate_video",
  "generate_talking_video",
  // Spends the owner's money on words a page could have written.
  "generate_voiceover",
  "post_chat",
  "open_direct_chat",
  // The question is a prompt for a Coworker; a page must not write it.
  "ask_coworker",
  // Core refuses it to a person or a room; to a Coworker or an assistant it
  // is a question, as ask_coworker is.
  "send_message",
  "reply_to_task",
  "assign_task",
  "update_assigned_task",
  "create_schedule",
  "update_schedule",
  "manage_reminder",
  "create_social_post",
  "update_social_post",
  "update_social_posts",
  "schedule_social_post",
  "cancel_social_post",
  "publish_social_post",
  "create_ad_campaign",
  "update_ad_campaign",
  "edit_ad_campaign",
  "delete_ad_campaign",
  // A brief is a prompt for a turn with this one's tools; a page must not write it.
  "start_background_run",
  "wait_for",
  // Words every Sokosumi user will read; a page must not write or show them.
  "save_announcement",
  "publish_announcement",
] as const satisfies readonly SokoBotCapability[];

/**
 * The tainted tools that stay refused even on work the owner asked for: they
 * reach people or systems beyond the owner's own workspace. The rest — briefing
 * a Coworker, hiring, saving to Files — is what a chained job the owner set
 * out ("research, build the site, have it reviewed") is made of. Social posts
 * are neither: see SOKO_BOT_TAINTED_OWN_POST_CAPABILITIES.
 */
/**
 * Social tools a tainted turn may still use on work the owner asked for:
 * creating a new post (which waits for a person's approval) and editing
 * unapproved drafts (`DRAFT` or `NEEDS_APPROVAL`; Core refuses tainted edits
 * to `SCHEDULED` or other posts). Rescheduling, cancelling or publishing a
 * post stay refused (see the outward list): a script in the turn can call
 * these tools too, and an approved post must not change under it.
 */
export const SOKO_BOT_TAINTED_OWN_POST_CAPABILITIES = [
  "create_social_post",
  "update_social_post",
  "update_social_posts",
] as const satisfies readonly (typeof SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES)[number][];

export const SOKO_BOT_WEB_TAINTED_OUTWARD_CAPABILITIES = [
  "run_integration_tool",
  "post_chat",
  "open_direct_chat",
  "schedule_social_post",
  "cancel_social_post",
  "publish_social_post",
  // Other people's newsletter subscriptions, and the emails that confirm them.
  "add_newsletter_subscriber",
  "import_newsletter_subscribers",
  "add_newsletter_subscribers_from_contacts",
  "update_newsletter_subscriber",
  "remove_newsletter_subscriber",
  "create_ad_campaign",
  "update_ad_campaign",
  "edit_ad_campaign",
  "delete_ad_campaign",
  "publish_announcement",
] as const satisfies readonly (typeof SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES)[number][];
