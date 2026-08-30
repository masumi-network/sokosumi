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
  "assign_task",
  "get_task_status",
  "reply_to_task",
  "update_assigned_task",
  "link_tasks",
  "find_agents",
  "get_agent_input_schema",
  "hire_agent",
  "get_job_status",
  "provide_job_input",
  "request_user_decision",
  "read_memory",
  "update_memory",
  "list_schedules",
  "create_schedule",
  "update_schedule",
  "delete_schedule",
  "list_chats",
  "read_chat",
  "post_chat",
  "open_direct_chat",
  "list_files",
  "upload_file",
  "list_integrations",
  "search_inbox",
  "read_email",
  "list_calendar_events",
  "list_integration_tools",
  "run_integration_tool",
] as const;

export type SokoBotCapability = (typeof SOKO_BOT_CAPABILITIES)[number];

const DIRECT_READ_CAPABILITIES = [
  "refresh_context",
  "get_task_status",
  "get_job_status",
  "read_memory",
  "list_schedules",
  "list_chats",
  "read_chat",
  "list_files",
  "list_integrations",
  "search_inbox",
  "read_email",
  "list_calendar_events",
  "list_integration_tools",
] as const satisfies readonly SokoBotCapability[];

/** Follow-ups the bot sets up for itself; never need owner approval. */
const SCHEDULE_CAPABILITIES = [
  "create_schedule",
  "update_schedule",
  "delete_schedule",
] as const satisfies readonly SokoBotCapability[];

/** Writes into chat and the owner's Drive; not available on read-only routes. */
const CHAT_FILE_WRITE_CAPABILITIES = [
  "post_chat",
  // Starts a conversation with somebody who did not ask for one. A write in
  // the plainest sense: it puts the bot in front of a colleague.
  "open_direct_chat",
  "upload_file",
  // Runs a real tool on a connected account (send, create, update). It is a
  // write in every sense, so it belongs with the writes rather than the reads.
  "run_integration_tool",
] as const satisfies readonly SokoBotCapability[];

/**
 * A teammate mentioning someone else's bot in a shared room answers into that
 * room, so the ceiling is strictly smaller than the owner's own CLARIFY turn:
 * the owner's private surfaces — durable memory, inbox, calendar, Drive,
 * connected accounts, and the bot's other chats — stay unreadable. Workspace
 * projects, tasks, and jobs are already visible to every member of the
 * workspace the turn runs in, so status reads remain available.
 */
export const SOKO_BOT_TEAMMATE_CAPABILITIES = [
  "refresh_context",
  "get_task_status",
  "get_job_status",
] as const satisfies readonly SokoBotCapability[];

/**
 * A turn another assistant asked for: the teammate ceiling, and nothing more.
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
  ...SOKO_BOT_TEAMMATE_CAPABILITIES,
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

export const SOKO_BOT_ROUTE_CAPABILITIES = {
  DIRECT_RESPONSE: [
    ...DIRECT_READ_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
    ...CHAT_FILE_WRITE_CAPABILITIES,
    "update_memory",
  ],
  CLARIFY: [...DIRECT_READ_CAPABILITIES],
  DELEGATE_TASK: [
    ...DIRECT_READ_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
    ...CHAT_FILE_WRITE_CAPABILITIES,
    "update_memory",
    "find_coworkers",
    "create_task",
    "update_task",
    "assign_task",
    "reply_to_task",
    "update_assigned_task",
    "link_tasks",
  ],
  HIRE_AGENT: [
    ...DIRECT_READ_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
    ...CHAT_FILE_WRITE_CAPABILITIES,
    "update_memory",
    "find_agents",
    "get_agent_input_schema",
    "hire_agent",
    "provide_job_input",
  ],
  MANAGE_WORK: [
    ...DIRECT_READ_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
    ...CHAT_FILE_WRITE_CAPABILITIES,
    "update_memory",
    "update_task",
    "assign_task",
    "reply_to_task",
    "update_assigned_task",
    "link_tasks",
    "find_coworkers",
    "create_task",
  ],
  MIXED: [...DIRECT_READ_CAPABILITIES],
} as const satisfies Record<SokoBotRoute, readonly SokoBotCapability[]>;

export const SOKO_BOT_MEMORY_LIMITS = {
  maxBytes: 16_384,
  maxEntriesPerSection: 12,
  maxEntryLength: 500,
} as const;

export interface TurnClassification {
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
}

const NEGATED_MUTATION_INTENT =
  /\b(?:don't|do not|never|not yet|not now|wait before|hold off(?: on)?)\b.{0,80}\b(?:create|make|open|assign|delegate|hand off|hire|book|run|use|post|send|share|publish|reply|upload|write|save|file|dm|message|contact|reach out)\b/i;

/** True when user explicitly says a mutation must not happen yet. */
export function hasSokoBotNegatedMutationIntent(message: string): boolean {
  return NEGATED_MUTATION_INTENT.test(message);
}

/**
 * Tools a negated instruction must also block. "Don't post this yet, just draft
 * it here" routes to DIRECT_RESPONSE, which grants chat, Drive, and connected
 * account writes; without this the model may do the very thing it was told not
 * to. Reads stay available so it can still answer.
 */
const NEGATABLE_WRITE_CAPABILITIES = new Set<string>([
  "post_chat",
  // "Don't open a chat with Nina yet, just draft it" blocked the posting and
  // opened the room anyway, which is the part the owner cannot undo: nobody
  // can leave or archive a direct once it exists.
  "open_direct_chat",
  "upload_file",
  "run_integration_tool",
  "create_schedule",
  "update_schedule",
  "delete_schedule",
  "reply_to_task",
  "update_assigned_task",
]);

export function isSokoBotNegatableWrite(capability: string): boolean {
  return NEGATABLE_WRITE_CAPABILITIES.has(capability);
}

export function isSokoBotRoute(value: string): value is SokoBotRoute {
  return SOKO_BOT_ROUTES.some((route) => route === value);
}

export function isSokoBotCapability(value: string): value is SokoBotCapability {
  return SOKO_BOT_CAPABILITIES.some((capability) => capability === value);
}
