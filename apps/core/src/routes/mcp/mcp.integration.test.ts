import { createMCPClient } from "@ai-sdk/mcp";
import { MCP_UI } from "@sokosumi/mcp-ui";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getWebAppBaseUrl } from "@/config/env";
import { errorHandler } from "@/helpers/error-handler";
import type { McpTokenVerification } from "@/lib/sokosumi-mcp/auth";
import {
  DEFAULT_TOOLSETS,
  MCP_TOOLS,
  MCP_TOOLSETS,
  toolsetOf,
} from "@/lib/sokosumi-mcp/tools";
import { MCP_UI_TOOLS, type McpUiTool } from "@/lib/sokosumi-mcp/ui-tools";

import mcpRouter from "./index";

/**
 * A real MCP client against `/mcp` over `app.request`: the handshake, the tool
 * list, a tool call that runs a `/v1` route in process, and the sign-in
 * challenge. Token verification and the database are the only fakes.
 */

const { CORE, USER, JOB, FIXTURE_UI_TOOLS, HIRE_AGENT, INPUT_SCHEMA } =
  vi.hoisted(() => ({
    HIRE_AGENT: {
      id: "cm_agent_analyst",
      name: "Market Analyst",
      blockchainIdentifier: "agent_analyst",
      apiBaseUrl: "https://agent.example.test",
      metadataOverride: null,
    },
    INPUT_SCHEMA: {
      input_data: [
        { id: "topic", type: "string", name: "Topic" },
        {
          id: "brief",
          type: "file",
          name: "Brief",
          data: { outputFormat: "url" },
        },
      ],
    },
    /**
     * An extra UI tool on the package's placeholder `hello` view, in this
     * file only: its twin needs no database (users_get).
     */
    FIXTURE_UI_TOOLS: [
      {
        name: "users_show_profile",
        data: "users_get",
        ui: "hello",
        description: "Show a user's profile.",
      },
    ] satisfies McpUiTool[],
    CORE: "https://core.example.test",
    /** A completed Job as Prisma returns it with `jobInclude`. */
    JOB: {
      id: "job_mcp",
      createdAt: new Date("2026-11-25T09:00:00.000Z"),
      updatedAt: new Date("2026-11-25T09:12:00.000Z"),
      completedAt: new Date("2026-11-25T09:12:00.000Z"),
      agentId: "agent_mcp",
      ownerId: "user_mcp",
      owner: { id: "user_mcp", name: "Ada", image: null },
      organizationId: null,
      organization: null,
      taskId: null,
      name: "Competitor pricing",
      jobType: "FREE",
      agentJobId: "agent_job_mcp",
      identifierFromPurchaser: null,
      payByTime: null,
      submitResultTime: null,
      unlockTime: null,
      externalDisputeUnlockTime: null,
      blockchainIdentifier: null,
      sellerVkey: null,
      refundedTransaction: null,
      refundedTransactionId: null,
      share: null,
      agent: {
        id: "agent_mcp",
        name: "Research Agent",
        icon: null,
        image: null,
        legalPrivacyPolicy: null,
        legalTerms: null,
        legalDpa: null,
        legalOther: null,
        metadataOverride: null,
      },
      transaction: null,
      transactionId: null,
      workspaceId: "0196a000-0000-7000-8000-00000000a001",
      workspace: {
        id: "0196a000-0000-7000-8000-00000000a001",
        organizationId: null,
        organization: null,
      },
      purchase: null,
      purchaseId: null,
      events: [
        {
          id: "event_completed",
          createdAt: new Date("2026-11-25T09:12:00.000Z"),
          updatedAt: new Date("2026-11-25T09:12:00.000Z"),
          status: "COMPLETED",
          inputSchema: null,
          input: null,
          result: "Three competitors bill yearly.",
          blobs: [],
          links: [],
        },
      ],
    },
    USER: {
      id: "user_mcp",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      name: "Ada",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      emailVerified: true,
      image: null,
      role: "user",
    },
  }));

/** The Task rows `task.findMany` answers; empty unless a test fills it. */
const TASK_ROWS = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("@/lib/auth", () => ({
  auth: { $context: Promise.resolve({ baseURL: `${CORE}/auth` }) },
}));
vi.mock("@/lib/sokosumi-mcp/auth", () => ({
  verifyMcpAccessToken: async (token: string): Promise<McpTokenVerification> =>
    token === "mcp-token"
      ? {
          status: "active",
          authContext: {
            actor: "user",
            userId: USER.id,
            organizationId: null,
            role: "user",
            authenticationMethod: "oauth",
          },
        }
      : { status: "invalid_token" },
}));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    user: { findUnique: async () => USER },
    // The hire form's twin reads the agent, then asks it for its input schema.
    // An empty agent list: the agents view test needs a successful agents_list.
    agent: {
      findUnique: async () => HIRE_AGENT,
      findMany: async () => [],
      count: async () => 0,
    },
    creditCost: { findMany: async () => [] },
    syncMetadata: { findUnique: async () => null },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    // An empty Task list: the board test needs a successful tasks_list.
    // No Task by id: tasks_get answers 404 (the Task detail test).
    task: {
      findMany: async () => TASK_ROWS,
      count: async () => TASK_ROWS.length,
      findFirst: async () => null,
    },
    // One completed Job: the Job status test needs a successful jobs_get.
    job: { findFirst: async () => JOB },
    taskEventMention: { findMany: async () => [] },
  };
  // The list reads its Network's rows through its scope's client.
  return { default: client, networkPrisma: () => client };
});
vi.mock("@sokosumi/masumi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sokosumi/masumi")>();
  const { ok } = await import("neverthrow");
  return {
    ...actual,
    createAgentClient: () => ({
      fetchAgentInputSchema: async () => ok(INPUT_SCHEMA),
    }),
  };
});
vi.mock("@/lib/sokosumi-mcp/ui-tools", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/sokosumi-mcp/ui-tools")>();
  return {
    ...actual,
    MCP_UI_TOOLS: [...actual.MCP_UI_TOOLS, ...FIXTURE_UI_TOOLS],
  };
});

/** Every view a UI tool uses, real rows first. */
const VIEW_RESOURCES = (
  [
    "tasks-board",
    "agents-hire",
    "job-status",
    "task-detail",
    "agents-browse",
    "social-posts",
    "hello",
  ] as const
).map((id) => ({
  uri: MCP_UI[id].uri,
  name: id,
  mimeType: "text/html;profile=mcp-app",
}));

const app = new Hono();
app.use(requestId());
app.onError(errorHandler);
app.route("/mcp", mcpRouter);

const clients: { close(): Promise<void> }[] = [];

async function connect(headers: Record<string, string>, query = "") {
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: `${CORE}/mcp${query}`,
      headers,
      fetch: async (input, init) => app.request(input, init),
    },
  });
  clients.push(client);
  return client;
}

afterEach(async () => {
  vi.restoreAllMocks();
  TASK_ROWS.length = 0;
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("Sokosumi MCP server", () => {
  it("serves its tools to a signed-in MCP client", async () => {
    const client = await connect(
      { Authorization: "Bearer mcp-token" },
      "?toolsets=workspaces,users,tasks",
    );

    expect(client.serverInfo).toMatchObject({ name: "sokosumi" });
    expect(client.instructions).toContain("workspaces_list");

    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "tasks_get")).toMatchObject({
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, workspace: { type: "string" } },
        required: ["id"],
      },
      annotations: { readOnlyHint: true },
    });

    const me = await client.callTool({
      name: "users_get",
      arguments: { id: "me" },
    });
    expect(me.isError).toBeFalsy();
    expect(me.structuredContent).toEqual({
      data: expect.objectContaining({ id: USER.id, email: USER.email }),
    });

    const missing = await client.callTool({
      name: "tasks_get",
      arguments: {},
    });
    expect(missing).toMatchObject({
      isError: true,
      structuredContent: { status: 422, message: 'Missing argument "id".' },
    });
  }, 15_000);

  it("lists the default toolsets, 45 tools at most, unless the URL picks others", async () => {
    const auth = { Authorization: "Bearer mcp-token" };
    const listed = async (query?: string) =>
      (await (await connect(auth, query)).listTools()).tools.map(
        (tool) => tool.name,
      );

    const isDefault = (name: string) =>
      (DEFAULT_TOOLSETS as readonly string[]).includes(toolsetOf(name));
    const defaults = await listed();
    expect(defaults).toEqual([
      ...MCP_TOOLS.map((tool) => tool.name).filter(isDefault),
      // A UI tool sits in its data twin's toolset (ADR 0083).
      ...MCP_UI_TOOLS.filter((tool) => isDefault(tool.data)).map(
        (tool) => tool.name,
      ),
    ]);
    // SOKD-410: feature toolsets keep the default small. Growing it is a
    // deliberate edit here; the ceiling is 45 (docs/agents/agent-surface.md).
    // UI tools count: 34 data tools, plus tasks_show_board, tasks_show and
    // workspaces_show_social_posts (its twin is in workspaces).
    expect(defaults).toHaveLength(34 + 3);
    expect(defaults).toContain("tasks_show_board");
    expect(defaults).toContain("tasks_show");
    expect(defaults).toContain("workspaces_show_social_posts");
    // jobs_show sits in the opt-in jobs toolset with jobs_get.
    expect(defaults).not.toContain("jobs_show");
    expect(new Set(defaults.map(toolsetOf))).toEqual(new Set(DEFAULT_TOOLSETS));

    expect(await listed("?toolsets=vendors,organizations")).toEqual(
      MCP_TOOLS.map((tool) => tool.name).filter((name) =>
        ["vendors", "organizations"].includes(toolsetOf(name)),
      ),
    );

    const drive = await connect(auth, "?toolsets=drive");
    expect(drive.instructions).toContain(
      "Drive tools other than tables take `scope`",
    );

    const client = await connect(auth, "?toolsets=tasks");
    expect(client.instructions).toContain("Toolsets on: tasks.");
    expect(client.instructions).not.toContain("Drive tools");
    expect(client.instructions).toContain(
      "Other tasks tools take a Task's `id`",
    );
    expect(client.instructions).not.toContain("workspaces_list");
    await expect(
      client.callTool({ name: "users_get", arguments: { id: "me" } }),
    ).rejects.toThrow("Unknown tool: users_get");

    // A Task feature toolset without `tasks` still needs the id rule, and
    // tasks_get to resolve SOK-12.
    const files = await connect(auth, "?toolsets=task-files");
    expect(files.instructions).toContain(
      "Other tasks tools take a Task's `id`",
    );
    expect(files.instructions).toContain("Add the tasks toolset for them.");
  }, 15_000);

  it("serves a UI tool's view as a ui:// resource and returns its twin's result", async () => {
    const auth = { Authorization: "Bearer mcp-token" };
    const client = await connect(auth, "?toolsets=users");
    expect(client.initializeResult.capabilities).toMatchObject({
      resources: {},
      extensions: { "io.modelcontextprotocol/ui": {} },
    });
    const { tools } = await client.listTools();
    const twin = tools.find((tool) => tool.name === "users_get");
    const show = tools.find((tool) => tool.name === "users_show_profile");

    // The twin's schema and annotations, the row's description, the link.
    expect(show).toEqual({
      name: "users_show_profile",
      description: "Show a user's profile.",
      inputSchema: twin?.inputSchema,
      annotations: twin?.annotations,
      _meta: { ui: { resourceUri: MCP_UI.hello.uri } },
    });
    // UI tools sit in their twin's toolset only.
    expect(tools.map((tool) => tool.name)).not.toContain("tasks_show");

    const data = await client.callTool({
      name: "users_get",
      arguments: { id: "me" },
    });
    const ui = await client.callTool({
      name: "users_show_profile",
      arguments: { id: "me" },
    });
    expect(data.structuredContent).toMatchObject({ data: { id: USER.id } });
    const { _meta: uiMeta, ...uiResult } = ui;
    const { _meta: dataMeta, ...dataResult } = data;
    expect(uiResult).toEqual(dataResult);
    // The SDK's own `_meta` (server info) stays; the view's is added.
    expect(uiMeta).toEqual({
      ...dataMeta,
      ui: { resourceUri: MCP_UI.hello.uri },
      sokosumi: { webBaseUrl: getWebAppBaseUrl() },
    });

    // A twin's error comes back the same, with the view still linked.
    const missing = await client.callTool({
      name: "users_show_profile",
      arguments: {},
    });
    expect(missing).toMatchObject({
      isError: true,
      structuredContent: { status: 422, message: 'Missing argument "id".' },
    });

    expect((await client.listResources()).resources).toEqual(VIEW_RESOURCES);
    expect(
      (await client.readResource({ uri: MCP_UI.hello.uri })).contents,
    ).toEqual([
      {
        uri: MCP_UI.hello.uri,
        mimeType: "text/html;profile=mcp-app",
        text: MCP_UI.hello.html,
      },
    ]);

    // A conversation from before a deploy still renders: the id resolves.
    const old = "ui://sokosumi/hello.00000000.html";
    expect((await client.readResource({ uri: old })).contents).toEqual([
      {
        uri: old,
        mimeType: "text/html;profile=mcp-app",
        text: MCP_UI.hello.html,
      },
    ]);
    await expect(
      client.readResource({ uri: "ui://sokosumi/nope.00000000.html" }),
    ).rejects.toThrow("Unknown view: ui://sokosumi/nope.00000000.html");

    // Views ignore toolsets: a conversation still renders after they change.
    const vendors = await connect(auth, "?toolsets=vendors");
    expect(
      (await vendors.listTools()).tools.filter((tool) => tool._meta?.ui),
    ).toEqual([]);
    expect((await vendors.listResources()).resources).toEqual(VIEW_RESOURCES);
    expect(
      (await vendors.readResource({ uri: MCP_UI.hello.uri })).contents,
    ).toEqual([
      {
        uri: MCP_UI.hello.uri,
        mimeType: "text/html;profile=mcp-app",
        text: MCP_UI.hello.html,
      },
    ]);
  }, 15_000);

  it("shows Tasks as a board with exactly tasks_list's result", async () => {
    // Imported here: at the top it would load zod before the routes extend it.
    const { workspaceRepository } = await import(
      "@sokosumi/database/repositories"
    );
    vi.spyOn(
      workspaceRepository,
      "resolveWorkspaceForContext",
    ).mockResolvedValue({
      id: "0196a000-0000-7000-8000-00000000a001",
      userId: USER.id,
      organizationId: null,
    } as Awaited<
      ReturnType<typeof workspaceRepository.resolveWorkspaceForContext>
    >);
    const client = await connect(
      { Authorization: "Bearer mcp-token" },
      "?toolsets=tasks",
    );
    const { tools } = await client.listTools();
    const twin = tools.find((tool) => tool.name === "tasks_list");
    const board = tools.find((tool) => tool.name === "tasks_show_board");
    expect(board).toMatchObject({
      inputSchema: twin?.inputSchema,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: MCP_UI["tasks-board"].uri } },
    });

    // The board always asks for Tasks without descriptions (SOKD-496), even
    // when the agent asks for them.
    TASK_ROWS.push(listedTask("A long runbook"));
    const args = { limit: 5, sort: "dueOn" };
    const full = await client.callTool({ name: "tasks_list", arguments: args });
    const data = await client.callTool({
      name: "tasks_list",
      arguments: { ...args, includeDescription: "false" },
    });
    const ui = await client.callTool({
      name: "tasks_show_board",
      arguments: { ...args, includeDescription: "true" },
    });
    expect(full).toMatchObject({
      structuredContent: { data: [{ description: "A long runbook" }] },
    });
    expect(data).toMatchObject({
      structuredContent: {
        data: [{ name: "Listed Task", description: null }],
        pagination: { total: 1 },
      },
    });
    expect(data.isError).toBeFalsy();
    const { _meta: uiMeta, ...uiResult } = ui;
    const { _meta: dataMeta, ...dataResult } = data;
    expect(uiResult).toEqual(dataResult);
    expect(uiMeta).toEqual({
      ...dataMeta,
      ui: { resourceUri: MCP_UI["tasks-board"].uri },
      sokosumi: { webBaseUrl: getWebAppBaseUrl() },
    });
  }, 15_000);

  it("keeps a team board of 100 Tasks with long descriptions light (SOKD-496)", async () => {
    const { workspaceRepository } = await import(
      "@sokosumi/database/repositories"
    );
    vi.spyOn(
      workspaceRepository,
      "resolveWorkspaceForContext",
    ).mockResolvedValue({
      id: "0196a000-0000-7000-8000-00000000a001",
      userId: USER.id,
      organizationId: null,
    } as Awaited<
      ReturnType<typeof workspaceRepository.resolveWorkspaceForContext>
    >);
    const client = await connect(
      { Authorization: "Bearer mcp-token" },
      "?toolsets=tasks",
    );
    // utxo's 100 newest Tasks had a median description of 12.5 KB.
    for (let index = 0; index < 100; index += 1) {
      TASK_ROWS.push({
        ...listedTask("Runbook step. ".repeat(900)),
        id: `0196a000-0000-7000-8000-${String(index).padStart(12, "0")}`,
      });
    }
    const args = { scope: "workspace", limit: 100 };
    const full = await client.callTool({ name: "tasks_list", arguments: args });
    const board = await client.callTool({
      name: "tasks_show_board",
      arguments: args,
    });

    const bytes = (result: unknown) => JSON.stringify(result).length;
    expect(board.structuredContent).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ description: null }),
      ]),
      pagination: { total: 100 },
    });
    // Claude.ai and ChatGPT rendered a 725 KB board result and failed a
    // 2.6 MB one. With text and structuredContent, this result counts twice.
    expect(bytes(full)).toBeGreaterThan(2_500_000);
    expect(bytes(board)).toBeLessThan(bytes(full) / 10);
    expect(bytes(board)).toBeLessThan(725_000);
  }, 15_000);

  it("shows the hire form in the agents toolset with exactly agents_input_schema's result", async () => {
    const client = await connect(
      { Authorization: "Bearer mcp-token" },
      "?toolsets=agents",
    );
    const { tools } = await client.listTools();
    const twin = tools.find((tool) => tool.name === "agents_input_schema");
    const hire = tools.find((tool) => tool.name === "agents_show_hire");
    expect(hire).toMatchObject({
      inputSchema: twin?.inputSchema,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: MCP_UI["agents-hire"].uri } },
    });
    // Off unless the agents toolset is on.
    const defaults = await connect({ Authorization: "Bearer mcp-token" });
    expect(
      (await defaults.listTools()).tools.map(({ name }) => name),
    ).not.toContain("agents_show_hire");

    const args = { id: HIRE_AGENT.id };
    const data = await client.callTool({
      name: "agents_input_schema",
      arguments: args,
    });
    const ui = await client.callTool({
      name: "agents_show_hire",
      arguments: args,
    });
    expect(data).toMatchObject({ structuredContent: { data: INPUT_SCHEMA } });
    expect(data.isError).toBeFalsy();
    const { _meta: uiMeta, ...uiResult } = ui;
    const { _meta: dataMeta, ...dataResult } = data;
    expect(uiResult).toEqual(dataResult);
    expect(uiMeta).toEqual({
      ...dataMeta,
      ui: { resourceUri: MCP_UI["agents-hire"].uri },
      sokosumi: { webBaseUrl: getWebAppBaseUrl() },
    });
  }, 15_000);

  it("shows a Job's status with exactly jobs_get's result, in the jobs toolset", async () => {
    // Imported here: at the top it would load zod before the routes extend it.
    const { workspaceRepository } = await import(
      "@sokosumi/database/repositories"
    );
    vi.spyOn(
      workspaceRepository,
      "resolveWorkspaceForContext",
    ).mockResolvedValue({
      id: JOB.workspaceId,
      userId: USER.id,
      organizationId: null,
    } as Awaited<
      ReturnType<typeof workspaceRepository.resolveWorkspaceForContext>
    >);
    const client = await connect(
      { Authorization: "Bearer mcp-token" },
      "?toolsets=jobs",
    );
    const { tools } = await client.listTools();
    const twin = tools.find((tool) => tool.name === "jobs_get");
    const show = tools.find((tool) => tool.name === "jobs_show");
    expect(show).toMatchObject({
      inputSchema: twin?.inputSchema,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: MCP_UI["job-status"].uri } },
    });

    const args = { id: JOB.id };
    const data = await client.callTool({ name: "jobs_get", arguments: args });
    const ui = await client.callTool({ name: "jobs_show", arguments: args });
    expect(data.isError).toBeFalsy();
    expect(data).toMatchObject({
      structuredContent: {
        data: {
          id: JOB.id,
          status: "completed",
          agent: { name: "Research Agent" },
        },
      },
    });
    const { _meta: uiMeta, ...uiResult } = ui;
    const { _meta: dataMeta, ...dataResult } = data;
    expect(uiResult).toEqual(dataResult);
    expect(uiMeta).toEqual({
      ...dataMeta,
      ui: { resourceUri: MCP_UI["job-status"].uri },
      sokosumi: { webBaseUrl: getWebAppBaseUrl() },
    });
  }, 15_000);

  it("shows a Task with exactly tasks_get's result", async () => {
    // Imported here: at the top it would load zod before the routes extend it.
    const { workspaceRepository } = await import(
      "@sokosumi/database/repositories"
    );
    vi.spyOn(
      workspaceRepository,
      "resolveWorkspaceForContext",
    ).mockResolvedValue({
      id: "0196a000-0000-7000-8000-00000000a001",
      userId: USER.id,
      organizationId: null,
    } as Awaited<
      ReturnType<typeof workspaceRepository.resolveWorkspaceForContext>
    >);
    const client = await connect({ Authorization: "Bearer mcp-token" });
    const { tools } = await client.listTools();
    const twin = tools.find((tool) => tool.name === "tasks_get");
    const show = tools.find((tool) => tool.name === "tasks_show");
    expect(show).toMatchObject({
      inputSchema: twin?.inputSchema,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: MCP_UI["task-detail"].uri } },
    });

    // The mocked database has no Task, so both answer the route's 404; the
    // board test above covers a successful result.
    const args = { id: "0196a000-0000-7000-8000-000000000039" };
    const data = await client.callTool({ name: "tasks_get", arguments: args });
    const ui = await client.callTool({ name: "tasks_show", arguments: args });
    expect(data).toMatchObject({
      isError: true,
      structuredContent: { status: 404 },
    });
    const { _meta: uiMeta, ...uiResult } = ui;
    const { _meta: dataMeta, ...dataResult } = data;
    expect(uiResult).toEqual(dataResult);
    expect(uiMeta).toEqual({
      ...dataMeta,
      ui: { resourceUri: MCP_UI["task-detail"].uri },
      sokosumi: { webBaseUrl: getWebAppBaseUrl() },
    });
  }, 15_000);

  it("shows agents with exactly agents_list's result, in the agents toolset", async () => {
    const client = await connect(
      { Authorization: "Bearer mcp-token" },
      "?toolsets=agents",
    );
    const { tools } = await client.listTools();
    const twin = tools.find((tool) => tool.name === "agents_list");
    const show = tools.find((tool) => tool.name === "agents_show");
    expect(show).toMatchObject({
      inputSchema: twin?.inputSchema,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: MCP_UI["agents-browse"].uri } },
    });
    // Off unless the agents toolset is on.
    const defaults = await connect({ Authorization: "Bearer mcp-token" });
    expect(
      (await defaults.listTools()).tools.map(({ name }) => name),
    ).not.toContain("agents_show");

    const args = { limit: 8, kind: "cardano" };
    const data = await client.callTool({
      name: "agents_list",
      arguments: args,
    });
    const ui = await client.callTool({ name: "agents_show", arguments: args });
    expect(data).toMatchObject({ structuredContent: { data: [] } });
    expect(data.isError).toBeFalsy();
    const { _meta: uiMeta, ...uiResult } = ui;
    const { _meta: dataMeta, ...dataResult } = data;
    expect(uiResult).toEqual(dataResult);
    expect(uiMeta).toEqual({
      ...dataMeta,
      ui: { resourceUri: MCP_UI["agents-browse"].uri },
      sokosumi: { webBaseUrl: getWebAppBaseUrl() },
    });
  }, 15_000);

  it("warns before a tool that spends credits", async () => {
    const client = await connect(
      { Authorization: "Bearer mcp-token" },
      "?toolsets=task-schedules,agents,image-studio,project-brand,ads,seo,contacts,chats,soko-bots",
    );
    const { tools } = await client.listTools();
    const spending = MCP_TOOLS.filter((tool) => tool.spendsCredits).map(
      (tool) => tool.name,
    );

    expect(spending).toEqual([
      "tasks_create_schedule",
      "tasks_resume_schedule",
      "tasks_run_schedule",
      "agents_hire",
      // ADR 0077: Image Studio starts spend credits; cancel does not.
      "projects_image_studio_generate",
      "projects_image_studio_video",
      "projects_image_studio_short_video",
      "projects_image_studio_talking_video",
      "projects_competitor_checks",
      "projects_check_competitors",
      "seo_audit_ask",
      "seo_audit_analyze",
      "seo_audit_create_monitor",
      "seo_audit_continue_crawl",
      "seo_project_analyze",
      "seo_project_create_monitor",
      "seo_project_continue_crawl",
      "contacts_enrich",
      "contacts_find_people",
      "soko_bots_ask_mine",
      "soko_bots_create_my_schedule",
      "soko_bots_set_my_proactive",
      "soko_bots_set_my_board_following",
      "soko_bots_set_my_team_standup",
      "soko_bots_lab_ingest",
      "soko_bots_lab_task_event",
      "soko_bots_ask",
      "soko_bots_create_schedule",
      "soko_bots_set_proactive",
      "soko_bots_set_board_following",
      "soko_bots_set_team_standup",
    ]);
    // Open-world: tools that spend credits, plus those acting outside Sokosumi.
    const openWorld = tools.filter((tool) => tool.annotations?.openWorldHint);
    expect(openWorld.map((tool) => tool.name)).toEqual(
      MCP_TOOLS.filter((tool) => tool.spendsCredits || tool.openWorld).map(
        (tool) => tool.name,
      ),
    );
    for (const tool of tools.filter((tool) => spending.includes(tool.name))) {
      expect(tool.description).toMatch(/^Spends workspace credits\./);
      const operation =
        MCP_TOOLS.find(({ name }) => name === tool.name)?.operation ?? "";
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        // A spending PUT (projects_competitor_checks) is safe to repeat.
        idempotentHint: operation.startsWith("PUT "),
        openWorldHint: true,
      });
    }
  });

  it("marks the ad campaign tools open-world and destructive", async () => {
    const client = await connect(
      { Authorization: "Bearer mcp-token" },
      "?toolsets=ads",
    );
    const { tools } = await client.listTools();
    const outside = MCP_TOOLS.filter(
      (tool) => tool.openWorld && tool.destructive,
    ).map((tool) => tool.name);

    expect(outside).toEqual([
      "projects_ads_campaign_create",
      "projects_ads_campaign_update",
      "projects_ads_campaign_edit",
    ]);
    const ads = tools.filter((tool) => outside.includes(tool.name));
    expect(ads.map((tool) => tool.name)).toEqual(outside);
    for (const tool of ads) {
      expect(tool.description).toMatch(
        /^Can lead to ad spend once a person resumes the campaign\./,
      );
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      });
    }
  }, 15_000);

  it("marks the tools that fetch a public URL open-world, not destructive", async () => {
    const client = await connect(
      { Authorization: "Bearer mcp-token" },
      "?toolsets=image-studio",
    );
    const { tools } = await client.listTools();
    const fetching = [
      "projects_image_studio_website_research",
      "projects_image_studio_website_logo",
      "projects_image_studio_products_import",
      "projects_image_studio_product_photo",
    ];

    const listed = tools.filter((tool) => fetching.includes(tool.name));
    expect(listed.map((tool) => tool.name)).toEqual(fetching);
    for (const tool of listed) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      });
    }
  }, 15_000);

  it("keeps SEO off by default and lists it on request", async () => {
    expect(DEFAULT_TOOLSETS).not.toContain("seo");

    const client = await connect(
      { Authorization: "Bearer mcp-token" },
      "?toolsets=seo",
    );
    const { tools } = await client.listTools();
    expect(client.instructions).toContain("Toolsets on: seo.");
    expect(tools.map((tool) => tool.name)).toEqual(
      MCP_TOOLS.map((tool) => tool.name).filter((name) =>
        name.startsWith("seo_"),
      ),
    );
  }, 15_000);

  it("refuses an unknown toolset by name", async () => {
    await expect(
      connect({ Authorization: "Bearer mcp-token" }, "?toolsets=tasks,nope"),
    ).rejects.toThrow();

    const response = await app.request(`${CORE}/mcp?toolsets=tasks,nope`, {
      method: "POST",
      headers: {
        Authorization: "Bearer mcp-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: `Unknown toolset "nope". Toolsets: ${MCP_TOOLSETS.join(", ")}.`,
    });
  });

  it("answers a 2026-07-28 request with JSON, and opens no subscription stream", async () => {
    const post = (method: string, params: Record<string, unknown>) =>
      app.request(`${CORE}/mcp?toolsets=users`, {
        method: "POST",
        headers: {
          Authorization: "Bearer mcp-token",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": method,
          ...(typeof params.name === "string"
            ? { "Mcp-Name": params.name }
            : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: {
            ...params,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": {
                name: "test",
                version: "1",
              },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      });

    const call = await post("tools/call", {
      name: "users_get",
      arguments: { id: "me" },
    });
    expect(call.headers.get("Content-Type")).toContain("application/json");
    expect(await call.json()).toMatchObject({
      result: { structuredContent: { data: { id: USER.id } } },
    });

    const listen = await post("subscriptions/listen", {
      notifications: { toolsListChanged: true },
    });
    expect(listen.headers.get("Content-Type")).toContain("application/json");
    expect(await listen.json()).toMatchObject({ error: { code: -32601 } });
  });

  it("challenges a client without a token to sign in", async () => {
    await expect(connect({})).rejects.toThrow();

    const response = await app.request(`${CORE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${CORE}/.well-known/oauth-protected-resource/mcp", scope="sokosumi:mcp"`,
    );
  });
});

/** A Task row as `tasks_list` reads it, with the fields its list item maps. */
function listedTask(description: string): Record<string, unknown> {
  const at = new Date("2026-11-26T09:00:00.000Z");
  return {
    id: "0196a000-0000-7000-8000-00000000b001",
    createdAt: at,
    updatedAt: at,
    ownerId: USER.id,
    owner: { id: USER.id, name: "Ada", image: null },
    organizationId: null,
    organization: null,
    projectId: null,
    assigneeId: null,
    assignee: null,
    name: "Listed Task",
    description,
    status: "READY",
    priority: "NONE",
    archivedAt: null,
    number: null,
    _count: { events: 0, jobs: 0 },
    events: [],
    workspace: {
      id: "0196a000-0000-7000-8000-00000000a001",
      organizationId: null,
      organization: null,
    },
  };
}
