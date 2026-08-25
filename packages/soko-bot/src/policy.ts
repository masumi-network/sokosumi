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
  "scratch_read",
  "scratch_write",
  "scratch_list",
] as const;

export type SokoBotCapability = (typeof SOKO_BOT_CAPABILITIES)[number];

const DIRECT_READ_CAPABILITIES = [
  "refresh_context",
  "get_task_status",
  "get_job_status",
  "read_memory",
  "list_schedules",
] as const satisfies readonly SokoBotCapability[];

/** Follow-ups the bot sets up for itself; never need owner approval. */
const SCHEDULE_CAPABILITIES = [
  "create_schedule",
  "update_schedule",
  "delete_schedule",
] as const satisfies readonly SokoBotCapability[];

export const SOKO_BOT_SCRATCH_CAPABILITIES = [
  "scratch_read",
  "scratch_write",
  "scratch_list",
] as const satisfies readonly SokoBotCapability[];

export const SOKO_BOT_ROUTE_CAPABILITIES = {
  DIRECT_RESPONSE: [
    ...DIRECT_READ_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
    "update_memory",
  ],
  CLARIFY: [...DIRECT_READ_CAPABILITIES],
  DELEGATE_TASK: [
    ...DIRECT_READ_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
    "update_memory",
    "find_coworkers",
    "create_task",
    "update_task",
    "assign_task",
    "request_user_decision",
  ],
  HIRE_AGENT: [
    ...DIRECT_READ_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
    "update_memory",
    "find_agents",
    "get_agent_input_schema",
    "hire_agent",
    "provide_job_input",
    "request_user_decision",
  ],
  MANAGE_WORK: [
    ...DIRECT_READ_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
    "update_memory",
    "update_task",
    "request_user_decision",
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
  /\b(?:don't|do not|never|not yet|not now|wait before|hold off(?: on)?)\b.{0,80}\b(?:create|make|open|assign|delegate|hand off|hire|book|run|use)\b/i;

/** True when user explicitly says a work mutation must not happen yet. */
export function hasSokoBotNegatedMutationIntent(message: string): boolean {
  return NEGATED_MUTATION_INTENT.test(message);
}

export function isSokoBotRoute(value: string): value is SokoBotRoute {
  return SOKO_BOT_ROUTES.some((route) => route === value);
}

export function isSokoBotCapability(value: string): value is SokoBotCapability {
  return SOKO_BOT_CAPABILITIES.some((capability) => capability === value);
}
