import { z } from "zod";

const id = z.string().trim().min(1).max(200);
const resource = { id };

/** Models identify resources; Core supplies every displayed field. */
export const chatResultReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), ...resource }).strict(),
  z.object({ kind: z.literal("task_schedule"), ...resource }).strict(),
  z.object({ kind: z.literal("bot_schedule"), ...resource }).strict(),
  z
    .object({ kind: z.literal("social_post"), ...resource, projectId: id })
    .strict(),
  z
    .object({ kind: z.literal("studio_job"), ...resource, projectId: id })
    .strict(),
  z.object({ kind: z.literal("job"), ...resource }).strict(),
  z.object({ kind: z.literal("file"), ...resource }).strict(),
  z.object({ kind: z.literal("decision"), ...resource }).strict(),
  /** A Cuso report: its message in his shared room. */
  z.object({ kind: z.literal("cmo_report"), ...resource }).strict(),
  z
    .object({
      kind: z.literal("project_selection"),
      projectIds: z.array(id).min(1).max(12),
    })
    .strict(),
]);

export type ChatResultReference = z.infer<typeof chatResultReferenceSchema>;
export const CHAT_RESULT_PREVIEW_LIMIT = 6;
export const sokoBotPreviewResultInputSchema = z
  .object({ reference: chatResultReferenceSchema })
  .strict();

/**
 * Canonical mapping from every committed write receipt capability (`ACTION_LABELS`)
 * to the native chat result card kind Core attaches for it, or `null` when the
 * write has no card (Core renders a receipt link in the reply instead).
 */
export const ACTION_RESULT_CARD_KINDS: Readonly<
  Record<string, ChatResultReference["kind"] | null>
> = {
  // SEO
  save_competitor_feed: null,
  add_seo_page: null,
  save_seo_scope: null,
  save_seo_keyword: null,
  save_seo_competitor: null,
  import_seo_audit: null,
  request_seo_analysis: "task",
  create_seo_action_task: "task",
  sync_seo_statistics: null,
  record_seo_page_change: null,

  // Newsletter and announcements (link-only; no native card kind)
  newsletter_draft_issue: null,
  create_newsletter_issue: null,
  update_newsletter_issue: null,
  delete_newsletter_issue: null,
  submit_newsletter_issue: null,
  update_newsletter_settings: null,
  save_announcement: null,
  publish_announcement: null,
  add_newsletter_subscriber: null,
  import_newsletter_subscribers: null,
  add_newsletter_subscribers_from_contacts: null,
  update_newsletter_subscriber: null,
  remove_newsletter_subscriber: null,

  // Reminders (nudge rows, not bot schedules)
  manage_reminder: null,

  // Tasks and tables
  create_task: "task",
  create_table: null,
  write_table_rows: null,
  update_table_columns: null,
  update_task: "task",
  archive_task: null,
  assign_task: "task",
  reply_to_task: "task",
  update_assigned_task: "task",
  link_tasks: null,
  set_task_parent: "task",
  stop_following_task: null,

  // Chat and messaging
  post_chat: null,
  open_direct_chat: null,
  ask_coworker: null,
  send_message: null,

  // Contacts and companies
  upsert_contact: null,
  update_contact: null,
  log_contact_interaction: null,
  merge_contacts: null,
  manage_contact_lists: null,
  bulk_update_contacts: null,
  update_company: null,
  export_contacts_to_table: null,
  find_people: null,
  find_investors: null,
  investor_warm_paths: null,
  enrich_contact: null,

  // Projects
  create_project: null,
  update_project: null,

  // Bot schedules and Task Schedules
  create_schedule: "bot_schedule",
  update_schedule: "bot_schedule",
  delete_schedule: null,
  save_task_schedule: "task_schedule",
  delete_task_schedule: null,

  // Memory
  update_memory: null,

  // Hired Agent Jobs
  hire_agent: "job",
  provide_job_input: "job",

  // Connected integrations and MCP servers
  run_integration_tool: null,
  run_mcp_tool: null,

  // Drive files
  upload_file: "file",
  generate_voiceover: "file",
  move_file: "file",
  delete_file: null,

  // Mail
  update_emails: null,
  draft_email: null,
  send_email_draft: null,
  save_email_attachment: "file",

  // Bot skills
  install_skill: null,
  remove_skill: null,

  // Content Studio
  generate_image: "studio_job",
  generate_video: "studio_job",
  generate_talking_video: "studio_job",

  // Social posts (batch `update_social_posts` commits per-post `update_social_post` receipts)
  create_social_post: "social_post",
  update_social_post: "social_post",
  schedule_social_post: "social_post",
  cancel_social_post: "social_post",
  publish_social_post: "social_post",

  // Ad campaigns
  create_ad_campaign: null,
  update_ad_campaign: null,
  edit_ad_campaign: null,
  delete_ad_campaign: null,
};

/**
 * Removal receipts whose target has a card kind: a later removal in the same
 * turn marks an earlier card on that resource `unavailable` instead of issuing
 * a 404 lookup; a removal-only turn emits no card.
 */
export const ACTION_RESULT_REMOVAL_KINDS: Readonly<
  Record<string, ChatResultReference["kind"]>
> = {
  archive_task: "task",
  delete_schedule: "bot_schedule",
  delete_task_schedule: "task_schedule",
  delete_file: "file",
};
