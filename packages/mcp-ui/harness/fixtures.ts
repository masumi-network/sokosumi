import type {
  McpUiHostContext,
  McpUiToolResultNotification,
} from "@modelcontextprotocol/ext-apps/app-bridge";

type ToolResult = McpUiToolResultNotification["params"];

export interface Fixture {
  /** Merged into the harness's host context, such as `displayMode`. */
  host?: McpUiHostContext;
  input?: Record<string, unknown>;
  /** Left out, the view stays in its loading state. */
  result?: ToolResult;
  cancelled?: boolean;
  /**
   * What the host answers a view's `tools/call`, by tool name: a result,
   * `"pending"` (never answers) or `"fail"` (rejects). A tool not named
   * gets `result`. `false` hides `serverTools` from the view.
   */
  calls?: Record<string, ToolResult | "pending" | "fail"> | false;
  /** Steps the screenshot script plays in the view before the shot. */
  play?: ({ fill: string; value: string } | { click: string })[];
  /** Shot at 320, 402 and 768px, like `default`. */
  allWidths?: boolean;
}

const sokosumi = { sokosumi: { webBaseUrl: "https://app.sokosumi.com" } };

const ACME = {
  id: "0196a000-0000-7000-8000-00000000a001",
  organizationId: "org_acme",
  organization: { id: "org_acme", name: "Acme Studio", slug: "acme" },
};

type Assignee =
  | { type: "user"; id: string; user: { id: string; name: string } }
  | { type: "coworker"; coworker: { id: string; name: string } }
  | { type: "sokoBot"; sokoBot: { id: string; name: string } }
  | null;

const ada: Assignee = {
  type: "user",
  id: "user_ada",
  user: { id: "user_ada", name: "Ada Lovelace" },
};
const grace: Assignee = {
  type: "user",
  id: "user_grace",
  user: { id: "user_grace", name: "Grace Hopper" },
};
const analyst: Assignee = {
  type: "coworker",
  coworker: { id: "cow_1", name: "Market Analyst" },
};
const bot: Assignee = {
  type: "sokoBot",
  sokoBot: { id: "0196a000-0000-7000-8000-00000000b001", name: "Soko" },
};

/** A `tasks_list` item, trimmed to the fields a list result always has. */
function task(
  number: number,
  name: string,
  status: string,
  assignee: Assignee,
  dueOn: string | null = null,
) {
  return {
    id: `0196a000-0000-7000-8000-${String(number).padStart(12, "0")}`,
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-24T09:00:00.000Z",
    workspaceId: ACME.id,
    organizationId: ACME.organizationId,
    number,
    identifier: `ACME-${number}`,
    name,
    description: "Plain record text the view never shows.",
    status,
    priority: "MEDIUM",
    dueOn,
    assignee,
    parentTaskId: null,
    workspace: ACME,
    jobsCount: 0,
    commentsCount: 0,
    statusSince: "2026-11-24T09:00:00.000Z",
  };
}

const BOARD_TASKS = [
  task(41, "Draft the Q1 launch plan", "DRAFT", ada),
  task(40, "Send the December newsletter", "QUEUED", bot, "2026-12-01"),
  task(
    39,
    "Research competitor pricing in the DACH market",
    "READY",
    analyst,
    "2026-11-28",
  ),
  task(38, "Refresh the onboarding checklist", "READY", grace),
  task(37, "Write alt text for the product gallery", "READY", null),
  task(36, "Audit the pricing page copy", "CREDITS_TOPPED_UP", analyst),
  task(35, "Summarise last week's support tickets", "RUNNING", bot),
  task(
    34,
    "Collect quotes from three print shops",
    "AWAITING_EXTERNAL",
    ada,
    "2026-11-27",
  ),
  task(
    33,
    "Approve the January social posts",
    "APPROVAL_REQUIRED",
    grace,
    "2026-11-26",
  ),
  task(32, "Answer the agent's question about tone", "INPUT_REQUIRED", ada),
  task(31, "Translate the FAQ into German", "COMPLETED", analyst),
  task(30, "Export the November ad report", "FAILED", bot),
  task(29, "Book the venue for the team offsite", "CANCELED", grace),
];

const boardResult = (data: unknown[], total: number) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ data }) }],
  structuredContent: {
    data,
    pagination: { cursor: null, limit: 20, total, nextCursor: null },
  },
  _meta: sokosumi,
});

/** `tasks_show_board` results: `tasks_list`'s, with Core's `_meta`. */
export const BOARD = {
  input: { workspace: "acme", limit: 20 },
  tasks: BOARD_TASKS,
  result: boardResult(BOARD_TASKS, 41),
  personal: boardResult(
    BOARD_TASKS.slice(0, 4).map((item) => ({
      ...item,
      organizationId: null,
      workspace: { id: ACME.id, organizationId: null, organization: null },
    })),
    4,
  ),
  empty: boardResult([], 0),
};

const data = (value: unknown, extra: Partial<ToolResult> = {}) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ data: value }) }],
  structuredContent: { data: value },
  ...extra,
});

/**
 * `agents_show_hire` results (`agents_input_schema`'s, with Core's `_meta`)
 * and what the view's calls return: the agent and its price, the balance,
 * and the hired Job.
 */
export const HIRE = {
  input: { id: "cm_agent_analyst", workspace: "acme" },
  schema: {
    input_data: [
      {
        id: "topic",
        type: "string",
        name: "Topic",
        data: {
          placeholder: "Pricing in the DACH market",
          description: "What the analyst researches.",
        },
        validations: [{ validation: "min", value: 3 }],
      },
      {
        id: "depth",
        type: "radio",
        name: "Depth",
        data: { values: ["Overview", "Deep dive"], default: "Overview" },
      },
      {
        id: "competitors",
        type: "number",
        name: "Competitors to compare",
        data: { default: 3 },
        validations: [
          { validation: "min", value: 1 },
          { validation: "max", value: 10 },
          { validation: "format", value: "integer" },
        ],
      },
      {
        id: "notes",
        type: "textarea",
        name: "Notes",
        validations: [{ validation: "optional", value: "true" }],
      },
      {
        id: "brief",
        type: "file",
        name: "Brief",
        data: { outputFormat: "url" },
        validations: [{ validation: "optional", value: "true" }],
      },
    ],
  },
  agent: {
    id: "cm_agent_analyst",
    name: "Market Analyst",
    credits: 12.5,
  },
  balance: { scope: "organization", spendable: 70 },
  job: {
    id: "cm_job_7f3k2",
    agentId: "cm_agent_analyst",
    status: "processing",
  },
};

const hireSchema = data(HIRE.schema, { _meta: sokosumi });
const hireCalls = {
  agents_get: data(HIRE.agent),
  workspaces_credits: data(HIRE.balance),
  agents_hire: data(HIRE.job),
};
const fillTopic = { fill: "Topic", value: "Pricing in the DACH market" };

/** Tool results the harness feeds each view, by view id, then by fixture name. */
export const FIXTURES: Record<string, Record<string, Fixture>> = {
  hello: {
    default: {
      input: { name: "Ada Lovelace" },
      result: {
        content: [{ type: "text", text: "Hello, Ada Lovelace" }],
        structuredContent: {
          name: "Ada Lovelace",
          createdAt: "2026-11-25T12:00:00Z",
          url: "https://app.sokosumi.com/tasks/SOK-1",
        },
        _meta: sokosumi,
      },
    },
    loading: { input: { name: "Ada Lovelace" } },
    empty: {
      result: {
        content: [{ type: "text", text: "No name" }],
        structuredContent: { name: "", createdAt: "2026-11-25T12:00:00Z" },
        _meta: sokosumi,
      },
    },
    error: {
      result: {
        content: [{ type: "text", text: "Task not found" }],
        isError: true,
      },
    },
  },
  "tasks-board": {
    default: { input: BOARD.input, result: BOARD.result },
    fullscreen: {
      host: { displayMode: "fullscreen" },
      input: BOARD.input,
      result: BOARD.result,
    },
    personal: { input: {}, result: BOARD.personal },
    loading: { input: BOARD.input },
    empty: { input: BOARD.input, result: BOARD.empty },
    error: {
      input: BOARD.input,
      result: {
        content: [{ type: "text", text: "Workspace not found" }],
        isError: true,
      },
    },
  },
  "agents-hire": {
    default: { input: HIRE.input, result: hireSchema, calls: hireCalls },
    invalid: {
      input: HIRE.input,
      result: hireSchema,
      calls: hireCalls,
      play: [{ click: "Review" }],
      allWidths: true,
    },
    confirm: {
      input: HIRE.input,
      result: hireSchema,
      calls: hireCalls,
      play: [fillTopic, { click: "Review" }],
      allWidths: true,
    },
    submitting: {
      input: HIRE.input,
      result: hireSchema,
      calls: { ...hireCalls, agents_hire: "pending" },
      play: [fillTopic, { click: "Review" }, { click: "Hire" }],
      allWidths: true,
    },
    success: {
      input: HIRE.input,
      result: hireSchema,
      calls: hireCalls,
      play: [fillTopic, { click: "Review" }, { click: "Hire" }],
      allWidths: true,
    },
    failed: {
      input: HIRE.input,
      result: hireSchema,
      calls: {
        ...hireCalls,
        agents_hire: data(null, {
          structuredContent: {
            status: 400,
            message: "Credit cost exceeds maximum accepted credits",
          },
          isError: true,
        }),
      },
      play: [fillTopic, { click: "Review" }, { click: "Hire" }],
      allWidths: true,
    },
    fallback: { input: HIRE.input, result: hireSchema, calls: false },
    loading: { input: HIRE.input },
    error: {
      input: HIRE.input,
      result: {
        content: [{ type: "text", text: "Agent not found" }],
        isError: true,
      },
    },
  },
};
