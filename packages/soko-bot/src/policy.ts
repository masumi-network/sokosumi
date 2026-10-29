export const SOKO_BOT_ROUTES = [
  "DIRECT_RESPONSE",
  "CLARIFY",
  "DELEGATE_TASK",
  "HIRE_AGENT",
  "MANAGE_WORK",
  "MIXED",
] as const;

export type SokoBotRoute = (typeof SOKO_BOT_ROUTES)[number];

export const SOKO_BOT_CAPABILITIES = [
  "refresh_context",
  "find_coworkers",
  "create_task",
  "update_task",
  "archive_task",
  "assign_task",
  "get_task_status",
  "preview_result",
  "list_tasks",
  "reply_to_task",
  "update_assigned_task",
  "link_tasks",
  "find_agents",
  "get_agent_input_schema",
  "hire_agent",
  "get_job_status",
  "provide_job_input",
  "read_memory",
  "update_memory",
  "list_schedules",
  "create_schedule",
  "update_schedule",
  "manage_reminder",
  "delete_schedule",
  "list_chats",
  "read_chat",
  "post_chat",
  "open_direct_chat",
  "ask_coworker",
  "list_files",
  "read_file",
  "list_tables",
  "read_table",
  "upload_file",
  "move_file",
  "update_emails",
  "draft_email",
  "send_email_draft",
  "save_email_attachment",
  "generate_image",
  "get_image",
  "generate_video",
  "get_video",
  "list_skills",
  "install_skill",
  "remove_skill",
  "create_table",
  "write_table_rows",
  "update_table_columns",
  "search_contacts",
  "get_contact",
  "list_contact_lists",
  "find_contact_duplicates",
  "upsert_contact",
  "update_contact",
  "log_contact_interaction",
  "merge_contacts",
  "manage_contact_lists",
  "list_integrations",
  "search_inbox",
  "read_email",
  "evaluate_with_jev",
  "list_calendar_events",
  "list_integration_tools",
  "run_integration_tool",
  "list_project_social_accounts",
  "list_social_posts",
  "list_social_post_statistics",
  "refresh_social_post_statistics",
  "list_social_account_statistics",
  "refresh_social_account_statistics",
  "get_social_post",
  "create_social_post",
  "newsletter_draft_issue",
  "update_social_post",
  "schedule_social_post",
  "cancel_social_post",
  "publish_social_post",
  "web_search",
  "web_fetch",
  "bash",
  "workspace_read",
  "workspace_write",
  "workspace_list",
  "workspace_search",
  "update_plan",
  "run_subagent",
  "start_background_run",
  "list_background_runs",
  "stop_background_run",
] as const;

export type SokoBotCapability = (typeof SOKO_BOT_CAPABILITIES)[number];

/**
 * Tools that run inside the bot's own sandbox: the web, a shell and a
 * persistent workspace. They touch no Sokosumi data, so every owner route
 * carries them; the teammate and bot-to-bot ceilings leave them out because the
 * workspace is the owner's, and Core strips them from turns it wrote itself.
 */
export const SOKO_BOT_SANDBOX_CAPABILITIES = [
  "web_search",
  "web_fetch",
  "bash",
  "workspace_read",
  "workspace_write",
  "workspace_list",
  "workspace_search",
  "update_plan",
  "run_subagent",
] as const satisfies readonly SokoBotCapability[];

export function isSokoBotSandboxCapability(
  value: string,
): value is (typeof SOKO_BOT_SANDBOX_CAPABILITIES)[number] {
  return (SOKO_BOT_SANDBOX_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Tools whose effect leaves Sokosumi, reaches another person, or runs later
 * without the taint. Once a turn has read the open web or run a shell command,
 * Core refuses these and the bot has to ask the owner first: a fetched page
 * must not be able to send mail, brief a Coworker, or queue either for a
 * later, clean turn.
 */
export const SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES = [
  "hire_agent",
  // Mail leaves the owner's mailbox; a page the bot read must not send it.
  "send_email_draft",
  "update_emails",
  // A skill is instructions the bot follows from then on; a page it read
  // must not be able to install one.
  "install_skill",
  "provide_job_input",
  "run_integration_tool",
  "upload_file",
  // Spends credits, and its prompt is the kind of thing a page can inject.
  "generate_image",
  "newsletter_draft_issue",
  "generate_video",
  "post_chat",
  "open_direct_chat",
  // The question is a prompt for a Coworker; a page must not write it.
  "ask_coworker",
  "reply_to_task",
  "assign_task",
  "update_assigned_task",
  "create_schedule",
  "update_schedule",
  "manage_reminder",
  "create_social_post",
  "update_social_post",
  "schedule_social_post",
  "cancel_social_post",
  "publish_social_post",
  // A brief is a prompt for a turn with this one's tools; a page must not write it.
  "start_background_run",
] as const satisfies readonly SokoBotCapability[];

/**
 * The tainted tools that stay refused even on work the owner asked for: they
 * reach people or systems beyond the owner's own workspace. The rest — briefing
 * a Coworker, hiring, saving to Files — is what a chained job the owner set
 * out ("research, build the site, have it reviewed") is made of.
 */
export const SOKO_BOT_WEB_TAINTED_OUTWARD_CAPABILITIES = [
  "run_integration_tool",
  "post_chat",
  "open_direct_chat",
  "create_social_post",
  "update_social_post",
  "schedule_social_post",
  "cancel_social_post",
  "publish_social_post",
] as const satisfies readonly (typeof SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES)[number][];

const DIRECT_READ_CAPABILITIES = [
  "refresh_context",
  "get_task_status",
  "preview_result",
  "list_tasks",
  "get_job_status",
  "read_memory",
  "list_schedules",
  "list_chats",
  "read_chat",
  "list_files",
  "read_file",
  "get_image",
  "get_video",
  "list_skills",
  "list_tables",
  "read_table",
  "search_contacts",
  "get_contact",
  "list_contact_lists",
  "find_contact_duplicates",
  "list_integrations",
  "search_inbox",
  "read_email",
  // Asks Jev typed questions about text the bot passes in; changes nothing.
  "evaluate_with_jev",
  "list_calendar_events",
  "list_integration_tools",
  "list_project_social_accounts",
  "list_social_posts",
  "list_social_post_statistics",
  "refresh_social_post_statistics",
  "list_social_account_statistics",
  "refresh_social_account_statistics",
  "get_social_post",
  "list_background_runs",
  // Reads the marketplace listing in Sokosumi and spends nothing, so "what
  // could this cost?" is answerable below the hire route's bar. The input
  // schema stays on the hire route: fetching it calls the seller's server.
  "find_agents",
] as const satisfies readonly SokoBotCapability[];

/** Social posts can publish externally, including edits to already queued content. */
const SOCIAL_WRITE_CAPABILITIES = [
  "create_social_post",
  "update_social_post",
  "schedule_social_post",
  "cancel_social_post",
  "publish_social_post",
] as const satisfies readonly SokoBotCapability[];

/** Long work the bot hands to itself in the background. */
const BACKGROUND_RUN_CAPABILITIES = [
  "start_background_run",
  "stop_background_run",
] as const satisfies readonly SokoBotCapability[];

/** Follow-ups the bot sets up for itself; never need owner approval. */
const SCHEDULE_CAPABILITIES = [
  "create_schedule",
  "update_schedule",
  "manage_reminder",
  "delete_schedule",
] as const satisfies readonly SokoBotCapability[];

/**
 * The bot's own installed skills. Core allows them only in the owner's own
 * chat, when the owner asked: a skill is third-party instructions the bot
 * follows on every later turn.
 */
const SKILL_CAPABILITIES = [
  "install_skill",
  "remove_skill",
] as const satisfies readonly SokoBotCapability[];

/**
 * The workspace's shared contacts: people, their channels, interactions and
 * lists. Every member sees them, so they are writes, but nothing leaves
 * Sokosumi — web research may fill them, as the prospects feature asks.
 */
const CONTACT_WRITE_CAPABILITIES = [
  "upsert_contact",
  "update_contact",
  "log_contact_interaction",
  "merge_contacts",
  "manage_contact_lists",
] as const satisfies readonly SokoBotCapability[];

/** Writes into chat and the owner's Drive; not available on read-only routes. */
const CHAT_FILE_WRITE_CAPABILITIES = [
  "newsletter_draft_issue",
  "post_chat",
  // Starts a conversation with somebody who did not ask for one. A write in
  // the plainest sense: it puts the bot in front of a colleague.
  "open_direct_chat",
  // Opens a private channel of the owner, the bot and Coworkers and asks them
  // something. Nobody else is in it, so it is not an outward post.
  "ask_coworker",
  "upload_file",
  "move_file",
  // The owner's mailbox: read state, archive, drafts. Sending is its own
  // tool, which Core allows only on the owner's word in their chat.
  "update_emails",
  "draft_email",
  "save_email_attachment",
  "generate_image",
  "generate_video",
  "create_table",
  "write_table_rows",
  "update_table_columns",
  ...CONTACT_WRITE_CAPABILITIES,
  // Runs a real tool on a connected account (send, create, update). It is a
  // write in every sense, so it belongs with the writes rather than the reads.
  "run_integration_tool",
] as const satisfies readonly SokoBotCapability[];

/**
 * A turn another assistant asked for: status reads, and nothing more.
 *
 * A consulted assistant answers by finishing its turn — the reply is posted
 * for it, in the room it was asked in. It gets no `post_chat`, which means it
 * cannot summon a third assistant, so a chain is one hop deep by construction
 * rather than by a counter. That also removes the only way it could post the
 * same answer twice, and the only way a room id supplied by the asking bot
 * could steer it somewhere its own owner cannot see.
 *
 * The cost is that A cannot ask B to go and consult C. That is deliberate: an
 * assistant deciding on its own to involve another is the step with nobody in
 * the room to notice it, and a person can always ask C directly.
 */
export const SOKO_BOT_BOT_TO_BOT_CAPABILITIES = [
  "refresh_context",
  "get_task_status",
  "list_tasks",
  "get_job_status",
] as const satisfies readonly SokoBotCapability[];

/**
 * Whether a hire exceeds what a turn nobody asked for may commit.
 *
 * A turn with no owner message is composed from untrusted material — mail
 * subjects, calendar titles, task comments — and hiring is the one tool that
 * buys from a marketplace outright. Text that talks its way onto that route
 * must not be able to spend the balance in one go. The owner asking for a
 * hire in their own chat is unaffected.
 */
export function exceedsUnattendedHireBudget(params: {
  source: string | null;
  chainDepth: number;
  maxCredits: number;
  ceiling: number;
}): boolean {
  const unattended = params.source !== "CHAT" || params.chainDepth > 0;
  return unattended && params.maxCredits > params.ceiling;
}

/** Who an unattended turn tells the bot to ask: a shared bot has no owner. */
function unattendedAsk(shared: boolean): string {
  return shared ? "the team in your shared room" : "the owner";
}

/** Why a second hire in a turn nobody asked for was refused. */
export function unattendedSecondHireRefusal(shared: boolean): string {
  return `A turn nobody asked for may hire once. Report what you found and ask ${unattendedAsk(shared)} before hiring again.`;
}

/** Why a hire over the unattended ceiling was refused. */
export function unattendedHireOverCeilingRefusal(
  shared: boolean,
  ceiling: number,
  maxCredits: number,
): string {
  return `A turn nobody asked for may commit at most ${ceiling} credits; this asked for ${maxCredits}. ${shared ? `Ask ${unattendedAsk(true)} instead.` : "Ask the owner in their chat instead."}`;
}

/** Reads plus the sandbox: what every owner turn starts from. */
const OWNER_BASE_CAPABILITIES = [
  ...DIRECT_READ_CAPABILITIES,
  ...SOKO_BOT_SANDBOX_CAPABILITIES,
] as const;

export const SOKO_BOT_ROUTE_CAPABILITIES = {
  DIRECT_RESPONSE: [...OWNER_BASE_CAPABILITIES],
  CLARIFY: [...OWNER_BASE_CAPABILITIES],
  DELEGATE_TASK: [
    ...OWNER_BASE_CAPABILITIES,
    ...BACKGROUND_RUN_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
    ...SKILL_CAPABILITIES,
    ...CHAT_FILE_WRITE_CAPABILITIES,
    "update_memory",
    "find_coworkers",
    "create_task",
    "update_task",
    "archive_task",
    "assign_task",
    "reply_to_task",
    "update_assigned_task",
    "link_tasks",
  ],
  HIRE_AGENT: [
    ...OWNER_BASE_CAPABILITIES,
    ...BACKGROUND_RUN_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
    ...SKILL_CAPABILITIES,
    ...CHAT_FILE_WRITE_CAPABILITIES,
    "update_memory",
    "get_agent_input_schema",
    "hire_agent",
    "provide_job_input",
  ],
  MANAGE_WORK: [
    ...OWNER_BASE_CAPABILITIES,
    ...BACKGROUND_RUN_CAPABILITIES,
    ...SOCIAL_WRITE_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
    ...SKILL_CAPABILITIES,
    ...CHAT_FILE_WRITE_CAPABILITIES,
    "update_memory",
    "update_task",
    "archive_task",
    "assign_task",
    "reply_to_task",
    "update_assigned_task",
    "link_tasks",
    "find_coworkers",
    "create_task",
  ],
  MIXED: [...OWNER_BASE_CAPABILITIES],
} as const satisfies Record<SokoBotRoute, readonly SokoBotCapability[]>;

export const SOKO_BOT_MEMORY_LIMITS = {
  maxBytes: 16_384,
  maxEntriesPerSection: 12,
  maxEntryLength: 500,
} as const;

/**
 * The reads every owner route has, and of its writes only those listed. For
 * turns Core starts itself, whose job needs far fewer writes than the route.
 */
export function limitSokoBotWrites(
  capabilities: readonly SokoBotCapability[],
  writes: readonly SokoBotCapability[],
): SokoBotCapability[] {
  const reads: readonly SokoBotCapability[] = OWNER_BASE_CAPABILITIES;
  return capabilities.filter(
    (capability) => reads.includes(capability) || writes.includes(capability),
  );
}

export function capabilitiesForClassification(
  classification: TurnClassification,
): readonly SokoBotCapability[] {
  const route = SOKO_BOT_ROUTE_CAPABILITIES[classification.route];
  if (
    classification.route !== "MANAGE_WORK" ||
    classification.writeScope === "WORK"
  )
    return route;
  if (!classification.writeScope) return OWNER_BASE_CAPABILITIES;
  const writes: Record<
    Exclude<NonNullable<TurnClassification["writeScope"]>, "WORK">,
    readonly SokoBotCapability[]
  > = {
    MEMORY: ["update_memory", ...SKILL_CAPABILITIES],
    SCHEDULE: SCHEDULE_CAPABILITIES,
    CHAT: ["post_chat", "open_direct_chat", "ask_coworker"],
    // A table the owner asks for is a Files table, not a markdown file.
    FILE: [
      "upload_file",
      "move_file",
      "save_email_attachment",
      "generate_image",
      "generate_video",
      "create_table",
      "write_table_rows",
      "update_table_columns",
      ...CONTACT_WRITE_CAPABILITIES,
    ],
    INTEGRATION: [
      "run_integration_tool",
      "update_emails",
      "draft_email",
      "send_email_draft",
    ],
    // A post's media must be in Files first; images sent in chat get there
    // through upload_file.
    SOCIAL: [...SOCIAL_WRITE_CAPABILITIES, "upload_file"],
  };
  return [...OWNER_BASE_CAPABILITIES, ...writes[classification.writeScope]];
}

export interface TurnClassification {
  writeScope?:
    | "WORK"
    | "MEMORY"
    | "SCHEDULE"
    | "CHAT"
    | "FILE"
    | "INTEGRATION"
    | "SOCIAL";
  candidateTaskIds?: string[];
  selectedIntentId?: string;
  continuation?: "NEW" | "CONTINUE" | "CANCEL" | "AMBIGUOUS";
  schemaVersion: 1;
  route: SokoBotRoute;
  confidence: number;
  rationaleSummary: string;
  requestedOutcome: string;
  candidateProjectIds: string[];
  candidateCoworkerIds: string[];
  candidateAgentIds: string[];
  requiresClarification: boolean;
  requiresApproval: boolean;
  proposedTaskBrief?: string;
  /** The write route Jev leaned toward but was not sure of; reads only. */
  unsureRoute?: SokoBotRoute;
  /** Jev's soft reads of a typed message: hints for context, never gates. */
  signals?: SokoBotTurnSignals;
}

/** Probabilities, 0–1, that a typed message does each of these. */
export interface SokoBotTurnSignals {
  refersToEarlier: number;
  statesPreference: number;
  aboutMail: number;
  aboutTasks: number;
}

export function isSokoBotCapability(value: string): value is SokoBotCapability {
  return SOKO_BOT_CAPABILITIES.some((capability) => capability === value);
}
