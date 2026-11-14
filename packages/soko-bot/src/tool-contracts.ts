import {
  contactInteractionInputSchema,
  createContactSchema,
  createDataTableSchema,
  mergeContactsSchema,
  newsletterBrandSchema,
  newsletterDraftInputSchema,
  tableBatchSchema,
  tableEvidenceSchema,
  tableMutationSchema,
  tableQuerySchema,
  tableValuesSchema,
} from "@sokosumi/utils";
import { z } from "zod";
import {
  cmoReportUpdateInputSchema,
  cmoSaveBrandBrainInputSchema,
  cmoSaveStrategyInputSchema,
} from "./cmo.js";
import { type SokoBotCapability } from "./policy.js";
import { sokoBotPreviewResultInputSchema } from "./result-previews.js";
import { SOKO_BOT_SEO_INPUT_SCHEMAS } from "./seo.js";
import {
  sokoBotBulkUpdateContactsInputSchema,
  sokoBotCompanyIdInputSchema,
  sokoBotContactIdInputSchema,
  sokoBotCountContactsInputSchema,
  sokoBotCreateProjectInputSchema,
  sokoBotEnrichContactInputSchema,
  sokoBotExportContactsInputSchema,
  sokoBotFindIntegrationsInputSchema,
  sokoBotFindPeopleInputSchema,
  sokoBotManageContactListsInputSchema,
  sokoBotSearchCompaniesInputSchema,
  sokoBotSearchContactsInputSchema,
  sokoBotUpdateCompanyInputSchema,
  sokoBotUpdateContactInputSchema,
  sokoBotUpdateProjectInputSchema,
} from "./tool-contracts-contacts.js";
import {
  adCampaignInputSchema,
  createAdCampaignInputSchema,
  createSocialPostInputSchema,
  editAdCampaignInputSchema,
  findAdTargetingInputSchema,
  getAdCampaignInputSchema,
  listAdCampaignsInputSchema,
  listSocialPostStatisticsInputSchema,
  listSocialPostsInputSchema,
  newsletterBrandPatchSchema,
  newsletterConsentInputSchema,
  newsletterDateSchema,
  newsletterIssueFields,
  newsletterIssueRefSchema,
  newsletterPageSchema,
  newsletterProjectInputSchema,
  newsletterSubscriberRefSchema,
  newsletterToolContentSchema,
  SOKO_BOT_NEWSLETTER_SUBSCRIBER_BATCH_MAX,
  scheduleSocialPostInputSchema,
  socialPostInputSchema,
  socialPostMutationInputSchema,
  socialProjectInputSchema,
  updateAdCampaignInputSchema,
  updateSocialPostInputSchema,
} from "./tool-contracts-marketing.js";
import {
  emptyInputSchema,
  sokoBotAgentIdInputSchema,
  sokoBotArchiveTaskInputSchema,
  sokoBotAssignTaskInputSchema,
  sokoBotCreateScheduleInputSchema,
  sokoBotCreateTaskInputSchema,
  sokoBotHireAgentInputSchema,
  sokoBotJobIdInputSchema,
  sokoBotLinkTasksInputSchema,
  sokoBotListTasksInputSchema,
  sokoBotMemoryUpdateInputSchema,
  sokoBotProvideJobInputSchema,
  sokoBotReplyToTaskInputSchema,
  sokoBotScheduleIdInputSchema,
  sokoBotSearchInputSchema,
  sokoBotTaskIdInputSchema,
  sokoBotUpdateAssignedTaskInputSchema,
  sokoBotUpdateScheduleInputSchema,
  sokoBotUpdateTaskInputSchema,
} from "./tool-contracts-tasks.js";
import {
  backgroundRunRefSchema,
  sokoBotAskCoworkerInputSchema,
  sokoBotBashInputSchema,
  sokoBotDeleteFileInputSchema,
  sokoBotDraftEmailInputSchema,
  sokoBotEvaluateWithJevInputSchema,
  sokoBotGenerateImageInputSchema,
  sokoBotGenerateVideoInputSchema,
  sokoBotGenerateVoiceoverInputSchema,
  sokoBotGetImageInputSchema,
  sokoBotGetVideoInputSchema,
  sokoBotInstallSkillInputSchema,
  sokoBotListCalendarEventsInputSchema,
  sokoBotListFilesInputSchema,
  sokoBotListIntegrationToolsInputSchema,
  sokoBotListSkillsInputSchema,
  sokoBotManageReminderInputSchema,
  sokoBotMoveFileInputSchema,
  sokoBotOpenDirectChatInputSchema,
  sokoBotPostChatInputSchema,
  sokoBotReadChatInputSchema,
  sokoBotReadEmailInputSchema,
  sokoBotReadFileInputSchema,
  sokoBotRemoveSkillInputSchema,
  sokoBotRunIntegrationToolInputSchema,
  sokoBotRunSubagentInputSchema,
  sokoBotSaveEmailAttachmentInputSchema,
  sokoBotSearchExaInputSchema,
  sokoBotSearchInboxInputSchema,
  sokoBotSendEmailDraftInputSchema,
  sokoBotStartBackgroundRunInputSchema,
  sokoBotUpdateEmailsInputSchema,
  sokoBotUpdatePlanInputSchema,
  sokoBotUploadFileInputSchema,
  sokoBotWaitForInputSchema,
  sokoBotWebFetchInputSchema,
  sokoBotWebSearchInputSchema,
  sokoBotWorkspaceImportFileInputSchema,
  sokoBotWorkspaceListInputSchema,
  sokoBotWorkspaceReadInputSchema,
  sokoBotWorkspaceSearchInputSchema,
  sokoBotWorkspaceWriteInputSchema,
} from "./tool-contracts-workspace.js";
import { WRITING_SKILLS } from "./writing-skills/index.js";

export const SOKO_BOT_TOOL_INPUT_SCHEMAS = {
  ...SOKO_BOT_SEO_INPUT_SCHEMAS,
  newsletter_draft_issue: newsletterDraftInputSchema.extend({
    projectId: z.uuid(),
  }),
  get_newsletter: newsletterProjectInputSchema,
  list_newsletter_issues: newsletterProjectInputSchema.extend({
    ...newsletterPageSchema,
    status: z
      .enum([
        "DRAFT",
        "NEEDS_APPROVAL",
        "SCHEDULED",
        "SENDING",
        "SENT",
        "FAILED",
        "CANCELED",
      ])
      .optional(),
  }),
  get_newsletter_issue: newsletterProjectInputSchema.extend({
    issueId: z.uuid(),
  }),
  get_newsletter_analytics: newsletterProjectInputSchema.extend({
    issueId: z.uuid().optional(),
    from: newsletterDateSchema.optional(),
    to: newsletterDateSchema.optional(),
    cursor: z.uuid().optional(),
    limit: z.number().int().min(1).max(100).default(10),
  }),
  list_newsletter_subscribers: newsletterProjectInputSchema.extend({
    ...newsletterPageSchema,
    status: z.enum(["PENDING", "ACTIVE", "UNSUBSCRIBED", "BOUNCED"]).optional(),
    search: z.string().trim().min(1).max(254).optional(),
  }),
  create_newsletter_issue: newsletterProjectInputSchema.extend(
    newsletterIssueFields,
  ),
  update_newsletter_issue: newsletterIssueRefSchema
    .extend({
      subject: newsletterIssueFields.subject.optional(),
      previewText: newsletterIssueFields.previewText,
      template: newsletterIssueFields.template.optional(),
      content: newsletterToolContentSchema.optional(),
    })
    .refine(
      ({ subject, previewText, template, content }) =>
        [subject, previewText, template, content].some(
          (value) => value !== undefined,
        ),
      { message: "Provide subject, previewText, template or content" },
    )
    .refine(({ template, content }) => !template || content, {
      message: "Changing the template needs the new content too",
    }),
  delete_newsletter_issue: newsletterIssueRefSchema,

  preview_newsletter_issue: newsletterProjectInputSchema
    .extend({
      issueId: z.uuid().optional(),
      subject: newsletterIssueFields.subject.optional(),
      previewText: newsletterIssueFields.previewText,
      template: newsletterIssueFields.template.optional(),
      content: newsletterToolContentSchema.optional(),
      brand: newsletterBrandSchema.optional(),
      includeHtml: z.boolean().optional(),
    })
    .refine(
      ({ issueId, subject, previewText, template, content }) =>
        issueId
          ? [subject, previewText, template, content].every(
              (value) => value === undefined,
            )
          : subject !== undefined &&
            template !== undefined &&
            content !== undefined,
      {
        message:
          "Provide issueId without content fields, or subject, template and content for unsaved content",
      },
    ),
  preview_newsletter_signup_form: newsletterProjectInputSchema,
  submit_newsletter_issue: newsletterIssueRefSchema,
  update_newsletter_settings: newsletterProjectInputSchema
    .extend({
      name: z.string().trim().min(1).max(200).optional(),
      brand: newsletterBrandPatchSchema.optional(),
      senderName: z.string().trim().min(1).max(200).optional(),
      replyTo: z.email().max(254).optional(),
      welcomeEmailEnabled: z.boolean().optional(),
      welcomeSubject: z.string().max(200).nullable().optional(),
      welcomeBody: z.string().max(100_000).nullable().optional(),
    })
    .refine(
      ({ projectId: _projectId, ...settings }) =>
        Object.values(settings).some((value) => value !== undefined),
      { message: "Provide at least one setting to change" },
    ),
  add_newsletter_subscriber: newsletterProjectInputSchema.extend({
    email: z.email().max(254),
    name: z.string().trim().max(200).nullable().optional(),
    consent: newsletterConsentInputSchema,
  }),
  import_newsletter_subscribers: newsletterProjectInputSchema.extend({
    /** A CSV file id from list_files. */
    fileId: z.string().min(1),
    consent: newsletterConsentInputSchema,
  }),
  add_newsletter_subscribers_from_contacts: newsletterProjectInputSchema
    .extend({
      contactIds: z
        .array(z.uuid())
        .max(SOKO_BOT_NEWSLETTER_SUBSCRIBER_BATCH_MAX)
        .optional(),
      contactListIds: z.array(z.uuid()).max(20).optional(),
      consent: newsletterConsentInputSchema,
    })
    .refine(
      ({ contactIds, contactListIds }) =>
        (contactIds?.length ?? 0) + (contactListIds?.length ?? 0) > 0,
      { message: "Provide at least one contact or contact list id" },
    ),
  update_newsletter_subscriber: newsletterSubscriberRefSchema
    .extend({
      name: z.string().trim().max(200).nullable().optional(),
      status: z.enum(["ACTIVE", "UNSUBSCRIBED"]).optional(),
    })
    .refine(({ name, status }) => name !== undefined || status !== undefined, {
      message: "Provide a name or status",
    }),
  remove_newsletter_subscriber: newsletterSubscriberRefSchema,

  start_background_run: sokoBotStartBackgroundRunInputSchema,
  wait_for: sokoBotWaitForInputSchema,
  list_background_runs: z.object({}).strict(),
  stop_background_run: backgroundRunRefSchema,
  list_project_social_accounts: socialProjectInputSchema,
  get_posting_instructions: socialProjectInputSchema,
  list_ad_accounts: socialProjectInputSchema,
  list_ad_campaigns: listAdCampaignsInputSchema,
  find_ad_targeting: findAdTargetingInputSchema,
  create_ad_campaign: createAdCampaignInputSchema,
  get_ad_campaign: getAdCampaignInputSchema,
  update_ad_campaign: updateAdCampaignInputSchema,
  edit_ad_campaign: editAdCampaignInputSchema,
  delete_ad_campaign: adCampaignInputSchema,
  get_market_keywords: socialProjectInputSchema,
  list_social_posts: listSocialPostsInputSchema,
  list_social_post_statistics: listSocialPostStatisticsInputSchema,
  refresh_social_post_statistics: socialPostInputSchema,
  list_social_account_statistics:
    listSocialPostStatisticsInputSchema.safeExtend({
      connectionId: z.uuid().optional(),
    }),
  refresh_social_account_statistics: socialProjectInputSchema.extend({
    connectionId: z.uuid(),
    continueHistory: z.boolean().optional(),
  }),
  get_social_post: socialPostInputSchema,
  create_social_post: createSocialPostInputSchema,
  update_social_post: updateSocialPostInputSchema,
  schedule_social_post: scheduleSocialPostInputSchema,
  cancel_social_post: socialPostMutationInputSchema,
  publish_social_post: socialPostMutationInputSchema,
  web_search: sokoBotWebSearchInputSchema,
  web_fetch: sokoBotWebFetchInputSchema,
  bash: sokoBotBashInputSchema,
  workspace_read: sokoBotWorkspaceReadInputSchema,
  workspace_write: sokoBotWorkspaceWriteInputSchema,
  workspace_list: sokoBotWorkspaceListInputSchema,
  workspace_search: sokoBotWorkspaceSearchInputSchema,
  update_plan: sokoBotUpdatePlanInputSchema,
  run_subagent: sokoBotRunSubagentInputSchema,
  save_brand_brain: cmoSaveBrandBrainInputSchema,
  search_exa: sokoBotSearchExaInputSchema,
  read_social_profile: z.object({ url: z.string().url().max(500) }),
  read_writing_skill: z.object({
    skill: z.enum(
      WRITING_SKILLS.map((skill) => skill.id) as [string, ...string[]],
    ),
  }),
  list_social_comments: z.object({}),
  handle_social_comment: z.object({
    commentId: z.uuid(),
    action: z.enum(["reply", "skip", "owner"]),
    /** The brand's reply; required for reply. */
    reply: z.string().max(300).optional(),
    /** Why it was skipped or needs the owner, in a short line. */
    note: z.string().max(500).optional(),
  }),
  save_strategy: cmoSaveStrategyInputSchema,
  report_update: cmoReportUpdateInputSchema,
  list_tables: z.object({
    taskId: z.string().max(200).optional(),
    cursor: z.uuid().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  read_table: tableQuerySchema.extend({
    tableId: z.uuid(),
    taskId: z.string().optional(),
  }),
  create_table: createDataTableSchema.extend({
    rows: z
      .array(
        z.object({
          id: z.uuid().optional(),
          values: z
            .record(z.string().min(1).max(100), tableValuesSchema.valueType)
            .describe(
              "Initial cells keyed by exact unique declared column name (preferred) or exact declared column UUID.",
            ),
          evidence: z
            .record(z.string().min(1).max(100), tableEvidenceSchema.valueType)
            .default({}),
        }),
      )
      .max(100)
      .default([]),
    taskId: z.string().max(200).optional(),
  }),
  write_table_rows: tableBatchSchema.safeExtend({ tableId: z.uuid() }),
  update_table_columns: tableMutationSchema.extend({
    tableId: z.uuid(),
    taskId: z.string().max(200).optional(),
    removeColumnIds: z.array(z.uuid()).min(1).max(100).optional(),
  }),
  search_contacts: sokoBotSearchContactsInputSchema,
  count_contacts: sokoBotCountContactsInputSchema,
  get_contact: sokoBotContactIdInputSchema,
  list_contact_lists: emptyInputSchema,
  search_companies: sokoBotSearchCompaniesInputSchema,
  get_company: sokoBotCompanyIdInputSchema,
  update_company: sokoBotUpdateCompanyInputSchema,
  bulk_update_contacts: sokoBotBulkUpdateContactsInputSchema,
  export_contacts_to_table: sokoBotExportContactsInputSchema,
  find_contact_duplicates: z
    .object({ contactId: z.uuid().optional() })
    .strict(),
  upsert_contact: createContactSchema,
  update_contact: sokoBotUpdateContactInputSchema,
  log_contact_interaction: contactInteractionInputSchema
    .extend({ contactId: z.uuid() })
    .strict(),
  merge_contacts: mergeContactsSchema,
  manage_contact_lists: sokoBotManageContactListsInputSchema,
  find_people: sokoBotFindPeopleInputSchema,
  enrich_contact: sokoBotEnrichContactInputSchema,
  create_project: sokoBotCreateProjectInputSchema,
  update_project: sokoBotUpdateProjectInputSchema,
  list_integration_tools: sokoBotListIntegrationToolsInputSchema,
  read_integration_tool: sokoBotRunIntegrationToolInputSchema,
  run_integration_tool: sokoBotRunIntegrationToolInputSchema,
  list_chats: emptyInputSchema,
  read_chat: sokoBotReadChatInputSchema,
  open_direct_chat: sokoBotOpenDirectChatInputSchema,
  ask_coworker: sokoBotAskCoworkerInputSchema,
  post_chat: sokoBotPostChatInputSchema,
  preview_result: sokoBotPreviewResultInputSchema,
  list_files: sokoBotListFilesInputSchema,
  read_file: sokoBotReadFileInputSchema,
  generate_image: sokoBotGenerateImageInputSchema,
  get_image: sokoBotGetImageInputSchema,
  generate_video: sokoBotGenerateVideoInputSchema,
  get_video: sokoBotGetVideoInputSchema,
  generate_voiceover: sokoBotGenerateVoiceoverInputSchema,
  workspace_import_file: sokoBotWorkspaceImportFileInputSchema,
  upload_file: sokoBotUploadFileInputSchema,
  move_file: sokoBotMoveFileInputSchema,
  delete_file: sokoBotDeleteFileInputSchema,
  update_emails: sokoBotUpdateEmailsInputSchema,
  draft_email: sokoBotDraftEmailInputSchema,
  send_email_draft: sokoBotSendEmailDraftInputSchema,
  save_email_attachment: sokoBotSaveEmailAttachmentInputSchema,
  list_skills: sokoBotListSkillsInputSchema,
  install_skill: sokoBotInstallSkillInputSchema,
  remove_skill: sokoBotRemoveSkillInputSchema,
  list_integrations: emptyInputSchema,
  find_integrations: sokoBotFindIntegrationsInputSchema,
  search_inbox: sokoBotSearchInboxInputSchema,
  read_email: sokoBotReadEmailInputSchema,
  evaluate_with_jev: sokoBotEvaluateWithJevInputSchema,
  list_calendar_events: sokoBotListCalendarEventsInputSchema,
  refresh_context: emptyInputSchema,
  find_coworkers: sokoBotSearchInputSchema,
  create_task: sokoBotCreateTaskInputSchema,
  update_task: sokoBotUpdateTaskInputSchema,
  archive_task: sokoBotArchiveTaskInputSchema,
  assign_task: sokoBotAssignTaskInputSchema,
  get_task_status: sokoBotTaskIdInputSchema,
  list_tasks: sokoBotListTasksInputSchema,
  reply_to_task: sokoBotReplyToTaskInputSchema,
  update_assigned_task: sokoBotUpdateAssignedTaskInputSchema,
  link_tasks: sokoBotLinkTasksInputSchema,
  find_agents: sokoBotSearchInputSchema,
  get_agent_input_schema: sokoBotAgentIdInputSchema,
  hire_agent: sokoBotHireAgentInputSchema,
  get_job_status: sokoBotJobIdInputSchema,
  provide_job_input: sokoBotProvideJobInputSchema,
  read_memory: emptyInputSchema,
  update_memory: sokoBotMemoryUpdateInputSchema,
  list_schedules: emptyInputSchema,
  create_schedule: sokoBotCreateScheduleInputSchema,
  update_schedule: sokoBotUpdateScheduleInputSchema,
  manage_reminder: sokoBotManageReminderInputSchema,
  delete_schedule: sokoBotScheduleIdInputSchema,
} as const satisfies Record<SokoBotCapability, z.ZodType>;
