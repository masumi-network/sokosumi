import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AuthorizedSokoBotRuntime,
  ExecuteSokoBotToolInput,
} from "../soko-bot-runtime.service";

const {
  serverFindManyMock,
  eventFindManyMock,
  isOwnerDirectedMock,
  appendMock,
  callToolMock,
} = vi.hoisted(() => ({
  serverFindManyMock: vi.fn(),
  eventFindManyMock: vi.fn(),
  isOwnerDirectedMock: vi.fn(),
  appendMock: vi.fn(),
  callToolMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotMcpServer: { findMany: serverFindManyMock },
    sokoBotRuntimeEvent: { findMany: eventFindManyMock },
  },
}));

vi.mock("@/lib/soko-bot/turn-loop", () => ({
  WEB_TAINT_EVENT: "sandbox.untrusted_input",
  isOwnerDirected: isOwnerDirectedMock,
  runtimeEvent: (type: string, data: unknown) => ({ type, data }),
  RuntimeEventLog: class {
    append = appendMock;
  },
}));

vi.mock("@/clients/mcp.client", () => ({
  callMcpServerTool: callToolMock,
}));

vi.mock("@/lib/evals/eval-mcp-server", () => ({
  evalMcpFetch: async () => null,
}));

import {
  dispatchMcpTools,
  mcpTaintSource,
  searchMcpTools,
} from "./dispatch-mcp";

const SERVER_ID = "01960001-0001-7001-8001-0000000000aa";
const tool = (name: string, readOnly: boolean, enabled = true) => ({
  name,
  description: `${name.replace("_", " ")} in the tracker`,
  inputSchema: { type: "object" },
  readOnly,
  enabled,
});
const SERVER = {
  id: SERVER_ID,
  name: "Linear",
  url: "https://mcp.example.test/mcp",
  credentialCiphertext: null,
  credentialKeyId: null,
  tools: [
    tool("search_issues", true),
    tool("create_issue", false),
    tool("delete_issue", false, false),
  ],
};

const authorized = {
  turn: { id: "turn-1", sokoBotId: "bot-1", workspaceId: "ws-1" },
} as unknown as AuthorizedSokoBotRuntime;

function call(capability: string, input: Record<string, unknown>) {
  return dispatchMcpTools(
    { capability, input, sessionId: "session-1" } as ExecuteSokoBotToolInput,
    authorized,
  );
}

function taintedBy(...sources: string[]) {
  eventFindManyMock.mockResolvedValue(
    sources.map((source) => ({ data: { source } })),
  );
}

describe("MCP tools for a Soko Bot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverFindManyMock.mockResolvedValue([SERVER]);
    taintedBy();
    isOwnerDirectedMock.mockResolvedValue(true);
    callToolMock.mockResolvedValue({ isError: false, text: "ok" });
  });

  it("lists servers with their switched-on tool count, without reading them", async () => {
    expect(await call("list_mcp_tools", {})).toEqual({
      servers: [{ name: "Linear", tools: 2 }],
    });
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("lists only switched-on tools, and marks the turn as having read the server", async () => {
    const listed = (await call("list_mcp_tools", { server: "linear" })) as {
      tools: { name: string }[];
    };
    expect(
      listed.tools.map((entry) => [
        entry.name,
        (entry as { callWith?: string }).callWith,
      ]),
    ).toEqual([
      ["search_issues", "read_mcp_tool"],
      ["create_issue", "run_mcp_tool"],
    ]);
    expect(appendMock).toHaveBeenCalledWith({
      type: "sandbox.untrusted_input",
      data: { source: mcpTaintSource(SERVER_ID) },
    });
  });

  it("matches a tool on any word of the query", () => {
    const names = searchMcpTools(SERVER.tools, "an issue please").map(
      (entry) => entry.name,
    );
    expect(names).toEqual(["search_issues", "create_issue", "delete_issue"]);
    expect(searchMcpTools(SERVER.tools, "nothing here")).toEqual([]);
  });

  it("reads with a read tool, and refuses a tool that changes things or is off", async () => {
    expect(
      await call("read_mcp_tool", { server: "Linear", tool: "search_issues" }),
    ).toMatchObject({ result: "ok", trust: "untrusted-data" });
    await expect(
      call("read_mcp_tool", { server: "Linear", tool: "create_issue" }),
    ).rejects.toThrow(/run_mcp_tool/);
    await expect(
      call("run_mcp_tool", { server: "Linear", tool: "delete_issue" }),
    ).rejects.toThrow(/no switched-on tool/);
    expect(callToolMock).toHaveBeenCalledTimes(1);
  });

  it("writes on the owner's word after reading only that same server", async () => {
    taintedBy(mcpTaintSource(SERVER_ID));
    await call("run_mcp_tool", {
      server: "Linear",
      tool: "create_issue",
      arguments: { title: "Fix Safari" },
    });
    expect(callToolMock).toHaveBeenCalledWith(
      { url: SERVER.url },
      "create_issue",
      { title: "Fix Safari" },
      undefined,
    );
  });

  it("refuses a write in a turn the owner did not start", async () => {
    isOwnerDirectedMock.mockResolvedValue(false);
    await expect(
      call("run_mcp_tool", { server: "Linear", tool: "create_issue" }),
    ).rejects.toThrow(/turn the owner started/);
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it("refuses a write after the turn read the web or another server", async () => {
    for (const other of ["web_search", mcpTaintSource("another-server")]) {
      taintedBy(mcpTaintSource(SERVER_ID), other);
      await expect(
        call("run_mcp_tool", { server: "Linear", tool: "create_issue" }),
      ).rejects.toThrow(/another server/);
    }
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it("names an unknown server without calling anything", async () => {
    await expect(
      call("read_mcp_tool", { server: "Jira", tool: "search_issues" }),
    ).rejects.toThrow(/No MCP server named Jira/);
  });
});
