/** What Core writes above a reply for each action a turn took: its receipt.
 * Core owns the wording; Web reads it to tell receipts from the bot's words. */
export const ACTION_LABELS: Record<string, string> = {
  save_competitor_feed: "Saved this week's competitor moves",
  add_seo_page: "Added SEO page",
  save_seo_scope: "Saved SEO page group",
  save_seo_keyword: "Saved SEO keyword",
  save_seo_competitor: "Saved SEO competitor",
  import_seo_audit: "Imported SEO audit",
  request_seo_analysis: "Requested SEO analysis",
  create_seo_action_task: "Created SEO action task",
  sync_seo_statistics: "Synced SEO statistics",
  record_seo_page_change: "Recorded SEO page change",

  newsletter_draft_issue: "Drafted newsletter issue for review",
  create_newsletter_issue: "Created newsletter draft",
  update_newsletter_issue: "Updated newsletter issue",
  delete_newsletter_issue: "Deleted newsletter issue",
  submit_newsletter_issue: "Submitted newsletter issue for approval",
  update_newsletter_settings: "Updated newsletter settings",
  save_announcement: "Saved announcement draft",
  publish_announcement: "Changed what every user sees",
  add_newsletter_subscriber: "Added newsletter subscriber",
  import_newsletter_subscribers: "Imported newsletter subscribers",
  add_newsletter_subscribers_from_contacts: "Added contacts to the newsletter",
  update_newsletter_subscriber: "Updated newsletter subscriber",
  remove_newsletter_subscriber: "Removed newsletter subscriber",
  manage_reminder: "Updated reminder",
  create_task: "Created task",
  create_table: "Created table",
  write_table_rows: "Updated table rows",
  update_table_columns: "Updated table columns",
  update_task: "Updated task",
  archive_task: "Archived task",
  assign_task: "Assigned task",
  reply_to_task: "Added a task comment",
  update_assigned_task: "Updated assigned task",
  link_tasks: "Linked tasks",
  set_task_parent: "Changed a task's parent",
  stop_following_task: "Stopped following task",
  post_chat: "Queued chat message",
  open_direct_chat: "Queued direct message",
  ask_coworker: "Asked a Coworker",
  send_message: "Sent a message",
  upsert_contact: "Saved contact",
  update_contact: "Updated contact",
  log_contact_interaction: "Logged a contact interaction",
  merge_contacts: "Merged contacts",
  manage_contact_lists: "Updated contact list",
  bulk_update_contacts: "Updated contacts",
  update_company: "Updated company",
  export_contacts_to_table: "Exported contacts to a table",
  find_people: "Found people",
  find_investors: "Ran an investor search",
  investor_warm_paths: "Researched the investor's portfolio",
  enrich_contact: "Enriched contact",
  create_project: "Created project",
  update_project: "Updated project",
  create_schedule: "Configured schedule",
  update_schedule: "Updated schedule",
  delete_schedule: "Deleted schedule",
  save_task_schedule: "Saved Task Schedule",
  delete_task_schedule: "Deleted Task Schedule",
  update_memory: "Updated memory",
  hire_agent: "Hired agent",
  provide_job_input: "Submitted job input",
  run_integration_tool: "Integration acknowledged operation",
  run_mcp_tool: "Ran a tool on an MCP server",
  upload_file: "Uploaded file",
  generate_voiceover: "Made voice-over",
  move_file: "Moved file",
  delete_file: "Deleted file",
  update_emails: "Updated mail",
  draft_email: "Drafted email",
  send_email_draft: "Sent email",
  save_email_attachment: "Saved email attachment",
  install_skill: "Installed skill",
  remove_skill: "Removed skill",
  generate_image: "Started image",
  generate_video: "Started video",
  generate_talking_video: "Started talking video",
  create_social_post: "Created social post",
  update_social_post: "Updated social post",
  schedule_social_post: "Scheduled social post",
  cancel_social_post: "Canceled social post",
  publish_social_post: "Published social post",
  create_ad_campaign: "Created paused ad campaign",
  update_ad_campaign: "Updated ad campaign",
  edit_ad_campaign: "Edited ad campaign",
  // No link: the campaign is gone.
  delete_ad_campaign: "Deleted ad campaign",
};

/** Receipt heads `actionLabel` writes besides the table's. */
const RECEIPT_HEADS = [
  ...Object.values(ACTION_LABELS),
  "Canceled task",
  "Completed task",
  "Resumed task",
  "Updated file",
  "Already satisfied",
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A receipt head as Core collapses it: the label, "Created 3 Tasks" for a
 * Task label, or "Updated social post (28×)" for any other.
 */
const HEAD = `(?:Previously verified: )?(?:${RECEIPT_HEADS.map((head) => {
  const label = escape(head);
  const task = / task$/i.test(head)
    ? `|${escape(head.slice(0, -5))} \\d+ Tasks`
    : "";
  return `${label}(?: \\(\\d+×\\))?${task}`;
}).join("|")})`;

/**
 * Only the unambiguous forms: a bare head, or a head whose target opens with
 * a markdown link (`[Name](/tasks/1)`, `([Open table](…))`), alone or after a
 * colon. Prose that starts with a label ("Updated memory with…") is not one.
 * Only a link's text may span lines (Core keeps a Task name's newlines), so
 * lines split where a head starts and a line of prose after a receipt stays.
 */
const LINK_TEXT = String.raw`\[(?:\\.|[^\]\\])*\]`;
const RECEIPT = new RegExp(
  String.raw`^${HEAD}(?:(?: |: )\(?${LINK_TEXT}(?:${LINK_TEXT}|[^\n[])*)?\.$`,
);
const NEXT_RECEIPT = new RegExp(`\\n(?=${HEAD})`);

function isReceiptParagraph(paragraph: string): boolean {
  return paragraph
    .split(NEXT_RECEIPT)
    .every((line) => RECEIPT.test(line.trim()));
}

/**
 * A reply without the receipts Core puts above the bot's words, for a
 * preview that should say what the bot said. A reply that is only receipts
 * keeps them: they are then all it says. Refusals and unknowns are not
 * receipts and stay.
 */
export function withoutActionReceipts(content: string): string {
  const paragraphs = content.trim().split(/\n{2,}/);
  const firstOwn = paragraphs.findIndex(
    (paragraph) => !isReceiptParagraph(paragraph),
  );
  return firstOwn > 0 ? paragraphs.slice(firstOwn).join("\n\n") : content;
}
