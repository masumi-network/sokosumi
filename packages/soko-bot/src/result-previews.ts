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

export const CHAT_RESULT_REFERENCE_KINDS = [
  "task",
  "task_schedule",
  "bot_schedule",
  "social_post",
  "studio_job",
  "job",
  "file",
  "decision",
  "cmo_report",
  "project_selection",
] as const;

export type ChatResultReferenceKind =
  (typeof CHAT_RESULT_REFERENCE_KINDS)[number];

export type ActionResultCardMapping =
  | { readonly kind: ChatResultReferenceKind }
  | { readonly kind: "no_card"; readonly reason: string };

const card = (kind: ChatResultReferenceKind): ActionResultCardMapping => ({
  kind,
});
const noCard = (reason: string): ActionResultCardMapping => ({
  kind: "no_card",
  reason,
});

/**
 * Explicit card-kind contract for every write capability in `ACTION_LABELS`.
 * Keeps result-card skills and receipt-driven card attachment complete: any
 * new write in `ACTION_LABELS` must declare either a `ChatResultReferenceKind`
 * or an explicit `"no_card"` reason (`skill-contracts.test.ts`).
 */
export const ACTION_RESULT_CARD_KINDS: Readonly<
  Record<string, ActionResultCardMapping>
> = {
  // SEO
  save_competitor_feed: noCard("competitor feed is not a chat result card"),
  add_seo_page: noCard("SEO page links to /seo, no card kind"),
  save_seo_scope: noCard("SEO page group links to /seo, no card kind"),
  save_seo_keyword: noCard("SEO keyword links to /seo, no card kind"),
  save_seo_competitor: noCard("SEO competitor links to /seo, no card kind"),
  import_seo_audit: noCard("SEO audit links to /seo, no card kind"),
  request_seo_analysis: card("task"),
  create_seo_action_task: card("task"),
  sync_seo_statistics: noCard(
    "SEO statistics sync links to /seo, no card kind",
  ),
  record_seo_page_change: noCard("SEO page change links to /seo, no card kind"),

  // Newsletter
  newsletter_draft_issue: noCard(
    "newsletter issues link to /newsletter/issues, no card kind",
  ),
  create_newsletter_issue: noCard(
    "newsletter issues link to /newsletter/issues, no card kind",
  ),
  update_newsletter_issue: noCard(
    "newsletter issues link to /newsletter/issues, no card kind",
  ),
  delete_newsletter_issue: noCard("deleted newsletter issue has no card"),
  submit_newsletter_issue: noCard(
    "newsletter issues link to /newsletter/issues, no card kind",
  ),
  update_newsletter_settings: noCard(
    "newsletter settings link to /newsletter/settings, no card kind",
  ),
  add_newsletter_subscriber: noCard(
    "newsletter subscribers link to /newsletter/subscribers, no card kind",
  ),
  import_newsletter_subscribers: noCard(
    "newsletter subscribers link to /newsletter/subscribers, no card kind",
  ),
  add_newsletter_subscribers_from_contacts: noCard(
    "newsletter subscribers link to /newsletter/subscribers, no card kind",
  ),
  update_newsletter_subscriber: noCard(
    "newsletter subscribers link to /newsletter/subscribers, no card kind",
  ),
  remove_newsletter_subscriber: noCard(
    "removed newsletter subscriber has no card",
  ),

  // Announcements
  save_announcement: noCard("announcements have no chat result card"),
  publish_announcement: noCard("announcements have no chat result card"),

  // Reminders & schedules
  manage_reminder: card("bot_schedule"),
  create_schedule: card("bot_schedule"),
  update_schedule: card("bot_schedule"),
  delete_schedule: noCard("deleted schedule has no card"),
  save_task_schedule: card("task_schedule"),
  delete_task_schedule: noCard("deleted task schedule has no card"),

  // Tasks
  create_task: card("task"),
  update_task: card("task"),
  archive_task: noCard("archived task renders unavailable, no card"),
  assign_task: card("task"),
  reply_to_task: card("task"),
  update_assigned_task: card("task"),
  link_tasks: card("task"),
  set_task_parent: card("task"),
  stop_following_task: noCard("unfollowing a task does not produce a card"),

  // Tables
  create_table: noCard("Drive tables link to /drive/tables, not a file card"),
  write_table_rows: noCard(
    "Drive tables link to /drive/tables, not a file card",
  ),
  update_table_columns: noCard(
    "Drive tables link to /drive/tables, not a file card",
  ),
  export_contacts_to_table: noCard(
    "Drive tables link to /drive/tables, not a file card",
  ),

  // Chat & messaging
  post_chat: noCard("chat message appears in the target room, no card"),
  open_direct_chat: noCard(
    "direct message appears in the target room, no card",
  ),
  ask_coworker: noCard("coworker question appears in group chat, no card"),
  send_message: noCard("message appears in the target room, no card"),

  // Contacts, companies & fundraising
  upsert_contact: noCard("contacts have no chat result card"),
  update_contact: noCard("contacts have no chat result card"),
  log_contact_interaction: noCard(
    "contact interactions have no chat result card",
  ),
  merge_contacts: noCard("contacts have no chat result card"),
  manage_contact_lists: noCard("contact lists have no chat result card"),
  bulk_update_contacts: noCard("contacts have no chat result card"),
  update_company: noCard("companies have no chat result card"),
  find_people: noCard("people search results have no chat result card"),
  find_investors: noCard("investor search results have no chat result card"),
  investor_warm_paths: noCard("warm-path research has no chat result card"),
  enrich_contact: noCard("contacts have no chat result card"),

  // Projects
  create_project: noCard(
    "projects link to /projects, no single-project card kind",
  ),
  update_project: noCard(
    "projects link to /projects, no single-project card kind",
  ),

  // Memory, skills & external tools
  update_memory: noCard("memory updates have no chat result card"),
  install_skill: noCard("skill installs have no chat result card"),
  remove_skill: noCard("removed skill has no card"),
  run_integration_tool: noCard(
    "external integration action has no chat result card",
  ),
  run_mcp_tool: noCard("external MCP action has no chat result card"),

  // Marketplace Jobs
  hire_agent: card("job"),
  provide_job_input: card("job"),

  // Files & voice-over
  upload_file: card("file"),
  generate_voiceover: card("file"),
  move_file: card("file"),
  delete_file: noCard("deleted file has no card"),
  save_email_attachment: card("file"),

  // Mail
  update_emails: noCard("mailbox actions have no chat result card"),
  draft_email: noCard("email drafts have no chat result card"),
  send_email_draft: noCard("sent emails have no chat result card"),

  // Content Studio
  generate_image: card("studio_job"),
  generate_video: card("studio_job"),
  generate_talking_video: card("studio_job"),

  // Social posts
  create_social_post: card("social_post"),
  update_social_post: card("social_post"),
  schedule_social_post: card("social_post"),
  cancel_social_post: card("social_post"),
  publish_social_post: card("social_post"),

  // Ads
  create_ad_campaign: noCard(
    "ad campaigns link to /ads/campaigns, no card kind",
  ),
  update_ad_campaign: noCard(
    "ad campaigns link to /ads/campaigns, no card kind",
  ),
  edit_ad_campaign: noCard("ad campaigns link to /ads/campaigns, no card kind"),
  delete_ad_campaign: noCard("deleted ad campaign has no card"),
};

export type ChatResultReference = z.infer<typeof chatResultReferenceSchema>;
export const CHAT_RESULT_PREVIEW_LIMIT = 6;
export const sokoBotPreviewResultInputSchema = z
  .object({ reference: chatResultReferenceSchema })
  .strict();
