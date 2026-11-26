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

const TEAM_STATUSES = [
  "DRAFT",
  "READY",
  "RUNNING",
  "INPUT_REQUIRED",
  "COMPLETED",
];
const TEAM = [ada, grace, analyst, bot, null];
/**
 * A team board as tasks_show_board returns it: the 100 newest of 1,586
 * Tasks, descriptions null (`includeDescription: "false"`, SOKD-496).
 */
const TEAM_TASKS = Array.from({ length: 100 }, (_, index) => ({
  ...task(
    1586 - index,
    `Team Task ${1586 - index}`,
    TEAM_STATUSES[index % 5] ?? "READY",
    TEAM[index % 4] ?? null,
  ),
  description: null,
}));

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
  team: boardResult(TEAM_TASKS, 1586),
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

const INPUT_QUESTION =
  "Who reads the summary, and which tone fits them? <b>Markup stays text.</b>";
/** Stored as text on the event, as the agent sent it. */
const INPUT_SCHEMA = JSON.stringify({
  input_data: [
    {
      id: "audience",
      type: "string",
      name: "Audience",
      data: { placeholder: "Founders in Germany" },
      validations: [{ validation: "min", value: 3 }],
    },
    {
      id: "tone",
      type: "radio",
      name: "Tone",
      data: { values: ["Formal", "Friendly"], default: "Formal" },
    },
  ],
});
const awaiting = jobEvent("AWAITING_INPUT", "2026-11-25T09:03:00.000Z", {
  inputSchema: INPUT_SCHEMA,
  result: INPUT_QUESTION,
});

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
  inputRequired: jobResult(job("input_required", [awaiting, running, started])),
  /** `jobs_input_request`'s answer for `inputRequired`: its event and fields. */
  inputRequest: data({
    eventId: awaiting.id,
    message: INPUT_QUESTION,
    inputSchema: INPUT_SCHEMA,
  }),
  /** `jobs_input`'s answer: Core's JobInput. */
  inputSent: data({
    id: "job_input_1",
    input: '{"audience":"Founders in Germany","tone":[1]}',
    inputHash: "input_hash",
    signature: "signature",
  }),
  /** Still `input_required` while Core waits for the agent, the request answered. */
  inputAnswered: jobResult(
    job("input_required", [
      { ...awaiting, input: { id: "job_input_1" } },
      running,
      started,
    ]),
  ),
  /** Core refuses the answer: the agent rejected it. */
  inputRefused: data(null, {
    structuredContent: {
      status: 422,
      message: "The agent could not accept this input",
    },
    isError: true,
  }),
};

/** The job-status view's calls while it answers `inputRequired`. */
const jobInputCalls = {
  jobs_input_request: JOB.inputRequest,
  jobs_input: JOB.inputSent,
};
const answerInput = [{ fill: "Audience", value: "Founders in Germany" }];

const toolResult = (structuredContent: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
  structuredContent,
});

const DESCRIPTION = `Compare our plans with the **three closest competitors** in Germany, Austria and Switzerland.

## What to collect

- List each plan's monthly price and what it includes.
- Note any free tier.

Start from the [pricing brief](https://app.sokosumi.com/tasks/0196a000-0000-7000-8000-000000000012), not [the competitor's site](https://example.com/pricing).

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

/** An `agents_list` Cardano item, trimmed to the fields its result always has. */
function listedAgent(
  id: string,
  name: string,
  credits: number,
  ratings: { total: number; average: number | null },
  summary: string | null,
) {
  return {
    kind: "cardano",
    id,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-11-20T09:00:00.000Z",
    name,
    image: "https://example.com/agent.png",
    icon: null,
    credits,
    summary,
    description: `${name} takes a brief and returns a short report.`,
    metrics: { executions: { count: 40, averageTime: 120 }, ratings },
    author: { name: "Masumi Labs", image: null, organization: null },
    legal: { privacyPolicy: null, terms: null, dpa: null, other: null },
    categories: [],
  };
}

const LISTED_AGENTS = [
  listedAgent(
    "cm_agent_analyst",
    "Market Analyst",
    12.5,
    { total: 128, average: 4.63 },
    "Researches markets, competitors and prices, and writes a short report.",
  ),
  listedAgent(
    "cm_agent_seo",
    "SEO Auditor",
    8,
    { total: 1, average: 4 },
    "Checks a site's pages for search issues and ranks the fixes.",
  ),
  listedAgent(
    "cm_agent_copy",
    "Brand Copywriter",
    0,
    { total: 0, average: null },
    "Writes headlines and short copy in your brand's voice.",
  ),
  listedAgent(
    "cm_agent_interviews",
    "Customer Interview Synthesizer for Product Discovery Teams",
    25,
    { total: 12, average: 4.9 },
    "Reads interview notes and transcripts, groups what customers said by theme, and lists the problems worth solving first, with quotes for each one so the team can check the source.",
  ),
  listedAgent(
    "cm_agent_cleaner",
    "Data Cleaner",
    3,
    { total: 5, average: 3.8 },
    null,
  ),
];

/** People pay x402 agents only through a Coworker, so the view skips them. */
const X402_AGENT = {
  kind: "x402",
  id: "cm_agent_x402",
  specification: "bazaar",
  name: "Bazaar Research Agent",
  description: "A research agent payable via x402",
  image: null,
  x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
  openApiSpecUrl: null,
  pricingType: "dynamic",
  isPayable: true,
  paymentSources: [],
};

const agentsResult = (data: unknown[]) => ({
  ...toolResult({
    data,
    pagination: { limit: 8, total: data.length, nextCursor: null },
  }),
  _meta: sokosumi,
});

const LAUNCH_PROJECT = "0196a000-0000-7000-8000-00000000c001";
const BLOG_PROJECT = "0196a000-0000-7000-8000-00000000c002";

/** A `workspaces_social_posts` item, trimmed to fields every post has. */
function socialPost(
  number: number,
  {
    projectId = LAUNCH_PROJECT,
    projectName = "Autumn launch",
    projectCmo = false,
    ...post
  }: {
    projectId?: string;
    projectName?: string;
    projectCmo?: boolean;
    text: string;
    provider?: string;
    status?: string;
    scheduledAt?: string | null;
    account?: { displayName: string | null; externalHandle: string | null };
    media?: unknown[];
    threadParts?: unknown[];
    revision?: number;
  },
) {
  const { account, ...rest } = post;
  return {
    post: {
      id: `0196a000-0000-7000-8000-${String(number).padStart(12, "0")}`,
      projectId,
      provider: "linkedin",
      firstComment: null,
      media: [],
      threadParts: [],
      status: "NEEDS_APPROVAL",
      scheduledAt: null,
      timezone: "Europe/Zurich",
      socialConnection: account
        ? { id: `0196a000-0000-7000-8000-00000000d00${number}`, ...account }
        : null,
      revision: 3,
      ...rest,
    },
    projectName,
    projectCmo,
  };
}

const SOCIAL_POSTS = [
  socialPost(1, {
    text: "Autumn pricing is live: every plan now includes two seats and a shared Workspace.\n\nRead what changed and why on our blog.",
    scheduledAt: "2026-11-27T08:30:00.000Z",
    account: { displayName: "Acme Studio", externalHandle: "acmestudio" },
  }),
  socialPost(2, {
    text: "Three things we learned shipping agents to 40 teams this year. A thread.",
    provider: "x",
    scheduledAt: "2026-11-28T15:00:00.000Z",
    account: { displayName: null, externalHandle: "acme" },
    threadParts: [{}, {}],
    media: [{}],
  }),
  socialPost(3, {
    projectId: BLOG_PROJECT,
    projectName: "Blog",
    projectCmo: true,
    text: "<b>Markup stays text.</b> New on the blog: how we plan a week of posts in ten minutes.",
    account: { displayName: "Acme Studio", externalHandle: "acmestudio" },
  }),
  socialPost(4, {
    text: "Already approved, so the view leaves it out.",
    status: "SCHEDULED",
    scheduledAt: "2026-11-29T09:00:00.000Z",
  }),
];

const socialResult = (posts: unknown[], total = posts.length) => ({
  ...toolResult({
    data: posts,
    pagination: { cursor: null, limit: 20, total },
  }),
  _meta: sokosumi,
});

/** `agents_show` results: `agents_list`'s, with Core's `_meta`. */
export const AGENTS = {
  input: { workspace: "acme", limit: 8, kind: "cardano" },
  agents: LISTED_AGENTS,
  x402: X402_AGENT,
  result: agentsResult([...LISTED_AGENTS, X402_AGENT]),
  many: agentsResult(
    Array.from({ length: 10 }, (_, index) =>
      listedAgent(
        `cm_agent_${index}`,
        `Agent ${index + 1}`,
        index,
        { total: 0, average: null },
        null,
      ),
    ),
  ),
  empty: agentsResult([X402_AGENT]),
  wrap: agentsResult,
};

/** `workspaces_show_social_posts` results and what the view's calls return. */
export const SOCIAL = {
  input: { workspace: "acme", status: "NEEDS_APPROVAL" },
  posts: SOCIAL_POSTS,
  result: socialResult(SOCIAL_POSTS),
  one: socialResult(SOCIAL_POSTS.slice(0, 1)),
  none: socialResult([]),
  /** Core holds 35 posts that need approval; this page has 3. */
  paged: socialResult(SOCIAL_POSTS.slice(0, 3), 35),
  /** A call without `status`: the newest page holds none that wait. */
  unfiltered: socialResult(SOCIAL_POSTS.slice(3), 40),
  /** The twin's answer after the first post was canceled. */
  afterCancel: socialResult(SOCIAL_POSTS.slice(1)),
  canceled: toolResult({
    data: { ...SOCIAL_POSTS[0].post, status: "CANCELED", revision: 4 },
  }),
  conflict: {
    ...toolResult({ status: 409, message: "Social post changed" }),
    isError: true,
  },
  missingToolset: {
    content: [
      {
        type: "text" as const,
        text: "Unknown tool: projects_social_post_cancel",
      },
    ],
    isError: true,
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
    team: {
      input: { workspace: "acme", scope: "workspace", limit: 100 },
      result: BOARD.team,
      allWidths: true,
    },
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
      calls: jobInputCalls,
      step: "input",
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
    inputInvalid: {
      input: JOB.input,
      result: JOB.inputRequired,
      calls: jobInputCalls,
      play: [{ click: "Send answer" }],
      step: "input",
      allWidths: true,
    },
    inputFailed: {
      input: JOB.input,
      result: JOB.inputRequired,
      calls: { ...jobInputCalls, jobs_input: JOB.inputRefused },
      play: [...answerInput, { click: "Send answer" }],
      step: "input-failed",
      allWidths: true,
    },
    inputSent: {
      input: JOB.input,
      result: JOB.inputRequired,
      calls: { ...jobInputCalls, jobs_get: JOB.inputAnswered },
      play: [...answerInput, { click: "Send answer" }],
      step: "input-sent",
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
  "agents-browse": {
    default: { input: AGENTS.input, result: AGENTS.result },
    sent: {
      step: "sent",
      input: AGENTS.input,
      result: AGENTS.result,
      play: [{ click: "Hire Market Analyst" }],
    },
    noWorkspace: { input: { limit: 8 }, result: AGENTS.result },
    loading: { input: AGENTS.input },
    empty: { input: AGENTS.input, result: AGENTS.empty },
    error: {
      input: AGENTS.input,
      result: {
        content: [{ type: "text", text: "Agents could not load" }],
        isError: true,
      },
    },
  },
  "social-posts": {
    default: { input: SOCIAL.input, result: SOCIAL.result },
    confirm: {
      input: SOCIAL.input,
      result: SOCIAL.one,
      play: [{ click: "Cancel" }],
      step: "confirm",
      allWidths: true,
    },
    canceling: {
      input: SOCIAL.input,
      result: SOCIAL.one,
      calls: { projects_social_post_cancel: "pending" },
      play: [{ click: "Cancel" }, { click: "Cancel post" }],
      step: "canceling",
    },
    canceled: {
      input: SOCIAL.input,
      result: SOCIAL.one,
      calls: { projects_social_post_cancel: SOCIAL.canceled },
      play: [{ click: "Cancel" }, { click: "Cancel post" }],
      step: "canceled",
      allWidths: true,
    },
    conflict: {
      input: SOCIAL.input,
      result: SOCIAL.one,
      calls: { projects_social_post_cancel: SOCIAL.conflict },
      play: [{ click: "Cancel" }, { click: "Cancel post" }],
      step: "conflict",
    },
    missingToolset: {
      input: SOCIAL.input,
      result: SOCIAL.one,
      calls: { projects_social_post_cancel: SOCIAL.missingToolset },
      play: [{ click: "Cancel" }, { click: "Cancel post" }],
      step: "missing-tool",
    },
    loading: { input: SOCIAL.input },
    empty: { input: SOCIAL.input, result: SOCIAL.none },
    error: {
      input: SOCIAL.input,
      result: {
        content: [{ type: "text", text: "Forbidden" }],
        isError: true,
      },
    },
  },
};
