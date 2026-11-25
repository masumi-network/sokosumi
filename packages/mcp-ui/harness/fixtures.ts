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
  /** The view's `data-step` once `play` is done; the shot waits for it. */
  step?: string;
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

const JOB_ID = "cmi4gmksz000104l8wps8p7fp";
const AGENT = {
  id: "agent_research",
  name: "Research Agent",
  overrideName: "Market Research",
  icon: "https://example.com/icon.png",
  image: null,
};

/** A `jobs_get` Job event, trimmed to what the view may read. */
function jobEvent(
  status: string,
  createdAt: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id: `event_${status.toLowerCase()}`,
    createdAt,
    updatedAt: createdAt,
    status,
    inputSchema: null,
    input: null,
    result: null,
    blobs: [],
    links: [],
    ...extra,
  };
}

const RESULT_TEXT = `# DACH pricing summary

Three competitors list prices in euros; two of them bill yearly only.

- Median monthly price: 49 EUR
- Lowest: 29 EUR (annual plan)

<script>alert("record text stays text")</script>`;

/** A `jobs_get` Job in `status`, with the events that led there. */
function job(status: string, events: unknown[], extra = {}) {
  return {
    id: JOB_ID,
    createdAt: "2026-11-25T09:00:00.000Z",
    updatedAt: "2026-11-25T09:04:00.000Z",
    completedAt: null,
    agentId: AGENT.id,
    organizationId: ACME.organizationId,
    organization: ACME.organization,
    workspace: ACME,
    taskId: null,
    name: "Competitor pricing in DACH",
    jobType: "PAID",
    status,
    credits: 5,
    result: null,
    jobStatusSettled: false,
    input: '{"prompt":"Compare pricing"}',
    agentJobId: "agent_job_1",
    agent: AGENT,
    events,
    share: null,
    ...extra,
  };
}

const jobResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ data }) }],
  structuredContent: { data },
  _meta: sokosumi,
});

const started = jobEvent("INITIATED", "2026-11-25T09:00:00.000Z");
const running = jobEvent("RUNNING", "2026-11-25T09:01:00.000Z");

/** `jobs_show` results: `jobs_get`'s, with Core's `_meta`. */
export const JOB = {
  input: { id: JOB_ID, workspace: "acme" },
  running: jobResult(job("processing", [running, started])),
  completed: jobResult(
    job(
      "completed",
      [
        jobEvent("COMPLETED", "2026-11-25T09:12:00.000Z", {
          result: RESULT_TEXT,
          blobs: [
            {
              id: "blob_report",
              createdAt: "2026-11-25T09:12:00.000Z",
              updatedAt: "2026-11-25T09:12:00.000Z",
              jobId: JOB_ID,
              sourceUrl: "https://agent.example.com/out/report.pdf",
              name: "dach-pricing-report.pdf",
              status: "READY",
              size: 248_000,
              mimeType: "application/pdf",
              fileUrl: "https://blob.sokosumi.com/jobs/report.pdf",
            },
            {
              id: "blob_sheet",
              createdAt: "2026-11-25T09:12:00.000Z",
              updatedAt: "2026-11-25T09:12:00.000Z",
              jobId: JOB_ID,
              sourceUrl: "http://agent.example.com/out/prices.csv",
              name: "prices.csv",
              status: "PENDING",
              size: null,
              mimeType: "text/csv",
              fileUrl: null,
            },
          ],
          links: [
            {
              id: "link_1",
              createdAt: "2026-11-25T09:12:00.000Z",
              updatedAt: "2026-11-25T09:12:00.000Z",
              jobId: JOB_ID,
              url: "https://competitor.example.com/pricing",
              title: "Competitor A pricing",
            },
            {
              id: "link_2",
              createdAt: "2026-11-25T09:12:00.000Z",
              updatedAt: "2026-11-25T09:12:00.000Z",
              jobId: JOB_ID,
              url: "javascript:alert(1)",
              title: null,
            },
          ],
        }),
        running,
        started,
      ],
      {
        completedAt: "2026-11-25T09:12:00.000Z",
        result: RESULT_TEXT,
      },
    ),
  ),
  failed: jobResult(
    job("failed", [
      jobEvent("FAILED", "2026-11-25T09:06:00.000Z"),
      running,
      started,
    ]),
  ),
  inputRequired: jobResult(
    job("input_required", [
      jobEvent("AWAITING_INPUT", "2026-11-25T09:03:00.000Z", {
        inputSchema: '{"input_data":[{"id":"tone","type":"string"}]}',
      }),
      running,
      started,
    ]),
  ),
};

const toolResult = (structuredContent: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
  structuredContent,
});

const DESCRIPTION = `Compare our plans with the three closest competitors in Germany, Austria and Switzerland.

- List each plan's monthly price and what it includes.
- Note any free tier.
<b>Markup stays text.</b>`;

const LONG_DESCRIPTION = `${DESCRIPTION}

${"Every competitor page we checked links its pricing from the footer, so the first pass reads the footer of each site, follows the pricing link, and notes the plan names exactly as written. ".repeat(6)}
https://example.com/a-very-long-link-without-any-spaces-that-must-wrap-instead-of-widening-the-card/pricing/dach/2026/plans-and-prices`;

/** A Task's events, as `tasks_get` embeds them: status changes without text, and comments. */
const TASK_EVENTS = [
  {
    id: "evt_1",
    createdAt: "2026-11-20T09:00:00.000Z",
    comment: null,
    status: "CREATED",
    actor: ada,
  },
  {
    id: "evt_2",
    createdAt: "2026-11-21T10:15:00.000Z",
    comment: "Please include annual prices where a site shows them.",
    status: null,
    actor: ada,
  },
  {
    id: "evt_3",
    createdAt: "2026-11-22T08:00:00.000Z",
    comment: "   ",
    status: "READY",
    actor: grace,
  },
  {
    id: "evt_4",
    createdAt: "2026-11-24T16:40:00.000Z",
    comment: "First pass done. Two sites hide prices behind a contact form.",
    status: null,
    actor: analyst,
  },
];

/** A Task's Jobs, oldest first, as `tasks_get` embeds them. */
const TASK_JOBS = [
  {
    id: "job_1",
    createdAt: "2026-11-22T09:30:00.000Z",
    name: "Competitor pricing scan",
    agentId: "agent_1",
    status: "failed",
  },
  {
    id: "job_2",
    createdAt: "2026-11-24T14:00:00.000Z",
    name: "Competitor pricing scan, second try",
    agentId: "agent_1",
    status: "completed",
  },
];

/** A `tasks_get` item, trimmed to the fields its result always has. */
const DETAIL_TASK = {
  ...task(
    39,
    "Research competitor pricing in the DACH market",
    "READY",
    analyst,
    "2026-11-28",
  ),
  description: DESCRIPTION,
  events: TASK_EVENTS,
  jobs: TASK_JOBS,
};

const detailResult = (fields: Record<string, unknown> = {}) => ({
  ...toolResult({ data: { ...DETAIL_TASK, ...fields } }),
  _meta: sokosumi,
});

/** `tasks_show` results: `tasks_get`'s, with Core's `_meta`. */
export const TASK = {
  input: { id: "ACME-39", workspace: "acme" },
  task: DETAIL_TASK,
  result: detailResult(),
  longDescription: LONG_DESCRIPTION,
  long: detailResult({ description: LONG_DESCRIPTION }),
  approval: detailResult({ status: "APPROVAL_REQUIRED" }),
  bare: detailResult({
    description: null,
    events: [],
    jobs: [],
    dueOn: null,
    assignee: null,
    workspace: { id: ACME.id, organizationId: null, organization: null },
  }),
  /** Core's error when only a person may take the step (ADR 0077). */
  personApproval: {
    ...toolResult({
      status: 403,
      kind: "person_approval_required",
      message: "A person approves this in Sokosumi",
      details: { webUrl: `https://app.sokosumi.com/tasks/${DETAIL_TASK.id}` },
    }),
    isError: true,
    _meta: sokosumi,
  },
};

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
      step: "form",
      input: HIRE.input,
      result: hireSchema,
      calls: hireCalls,
      play: [{ click: "Review" }],
      allWidths: true,
    },
    confirm: {
      step: "confirm",
      input: HIRE.input,
      result: hireSchema,
      calls: hireCalls,
      play: [fillTopic, { click: "Review" }],
      allWidths: true,
    },
    submitting: {
      step: "hiring",
      input: HIRE.input,
      result: hireSchema,
      calls: { ...hireCalls, agents_hire: "pending" },
      play: [fillTopic, { click: "Review" }, { click: "Hire" }],
      allWidths: true,
    },
    success: {
      step: "hired",
      input: HIRE.input,
      result: hireSchema,
      calls: hireCalls,
      play: [fillTopic, { click: "Review" }, { click: "Hire" }],
      allWidths: true,
    },
    failed: {
      step: "refused",
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
  "job-status": {
    default: { input: JOB.input, result: JOB.running, allWidths: true },
    completed: { input: JOB.input, result: JOB.completed, allWidths: true },
    failed: { input: JOB.input, result: JOB.failed, allWidths: true },
    inputRequired: {
      input: JOB.input,
      result: JOB.inputRequired,
      allWidths: true,
    },
    missingToolset: {
      input: JOB.input,
      result: JOB.running,
      calls: { jobs_get: "fail" },
      step: "missing-tool",
    },
    gone: {
      input: JOB.input,
      result: JOB.running,
      calls: {
        jobs_get: {
          content: [
            { type: "text", text: '{"status":404,"message":"Job not found"}' },
          ],
          structuredContent: { status: 404, message: "Job not found" },
          isError: true,
        },
      },
      step: "gone",
    },
    loading: { input: JOB.input },
    error: {
      input: JOB.input,
      result: {
        content: [{ type: "text", text: "Job not found" }],
        isError: true,
      },
    },
  },
  "task-detail": {
    default: { input: TASK.input, result: TASK.result },
    timeline: {
      input: TASK.input,
      result: TASK.result,
      play: [{ click: "Timeline" }],
      allWidths: true,
    },
    long: { input: TASK.input, result: TASK.long, allWidths: true },
    awaitingApproval: {
      input: TASK.input,
      result: TASK.approval,
    },
    bare: {
      input: { id: "ACME-39" },
      result: TASK.bare,
      play: [{ click: "Timeline" }],
    },
    loading: { input: TASK.input },
    error: {
      input: TASK.input,
      result: {
        content: [{ type: "text", text: "Task not found" }],
        isError: true,
      },
    },
    approval: { input: TASK.input, result: TASK.personApproval },
  },
};
