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
  "list_files",
  "read_file",
  "list_tables",
  "read_table",
  "upload_file",
  "generate_image",
  "get_image",
  "create_table",
  "write_table_rows",
  "update_table_columns",
  "list_integrations",
  "search_inbox",
  "read_email",
  "list_calendar_events",
  "list_integration_tools",
  "run_integration_tool",
  "list_project_social_accounts",
  "list_social_posts",
  "get_social_post",
  "create_social_post",
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
  "save_brand_brain",
  "save_strategy",
] as const;

export type SokoBotCapability = (typeof SOKO_BOT_CAPABILITIES)[number];

/**
 * Tools only CMO (Cuso) bots carry. They write the bot's own marketing
 * workspace (Brand Brain, strategy), so a CMO bot has them on every turn and
 * no other bot ever does; `applyVersionCapabilities` enforces both.
 */
export const SOKO_BOT_CMO_CAPABILITIES = [
  "save_brand_brain",
  "save_strategy",
] as const satisfies readonly SokoBotCapability[];

export function isSokoBotCmoCapability(value: string): boolean {
  return (SOKO_BOT_CMO_CAPABILITIES as readonly string[]).includes(value);
}

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
  "provide_job_input",
  "run_integration_tool",
  "upload_file",
  // Spends credits, and its prompt is the kind of thing a page can inject.
  "generate_image",
  "post_chat",
  "open_direct_chat",
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
] as const satisfies readonly SokoBotCapability[];

const DIRECT_READ_CAPABILITIES = [
  "refresh_context",
  "get_task_status",
  "list_tasks",
  "get_job_status",
  "read_memory",
  "list_schedules",
  "list_chats",
  "read_chat",
  "list_files",
  "read_file",
  "get_image",
  "list_tables",
  "read_table",
  "list_integrations",
  "search_inbox",
  "read_email",
  "list_calendar_events",
  "list_integration_tools",
  "list_project_social_accounts",
  "list_social_posts",
  "get_social_post",
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

/** Follow-ups the bot sets up for itself; never need owner approval. */
const SCHEDULE_CAPABILITIES = [
  "create_schedule",
  "update_schedule",
  "manage_reminder",
  "delete_schedule",
] as const satisfies readonly SokoBotCapability[];

/** Writes into chat and the owner's Drive; not available on read-only routes. */
const CHAT_FILE_WRITE_CAPABILITIES = [
  "post_chat",
  // Starts a conversation with somebody who did not ask for one. A write in
  // the plainest sense: it puts the bot in front of a colleague.
  "open_direct_chat",
  "upload_file",
  "generate_image",
  "create_table",
  "write_table_rows",
  "update_table_columns",
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
    ...SCHEDULE_CAPABILITIES,
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
    ...SCHEDULE_CAPABILITIES,
    ...CHAT_FILE_WRITE_CAPABILITIES,
    "update_memory",
    "get_agent_input_schema",
    "hire_agent",
    "provide_job_input",
  ],
  MANAGE_WORK: [
    ...OWNER_BASE_CAPABILITIES,
    ...SOCIAL_WRITE_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
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
    MEMORY: ["update_memory"],
    SCHEDULE: SCHEDULE_CAPABILITIES,
    CHAT: ["post_chat", "open_direct_chat"],
    // A table the owner asks for is a Files table, not a markdown file.
    FILE: [
      "upload_file",
      "generate_image",
      "create_table",
      "write_table_rows",
      "update_table_columns",
    ],
    INTEGRATION: ["run_integration_tool"],
    SOCIAL: SOCIAL_WRITE_CAPABILITIES,
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
}

export function isSokoBotCapability(value: string): value is SokoBotCapability {
  return SOKO_BOT_CAPABILITIES.some((capability) => capability === value);
}
