import { describe, expect, it } from "vitest";

import { fakeMcpServer } from "@/lib/evals/fake-mcp-server";

import {
  callMcpServerTool,
  listMcpServerTools,
  MCP_RESULT_MAX_CHARS,
  MCP_TOOL_DESCRIPTION_MAX_CHARS,
} from "./mcp.client";

const target = {
  url: "https://mcp.example.test/mcp",
  headers: { Authorization: "Bearer key-123" },
};

describe("MCP client", () => {
  it("lists a server's tools with its read-only hints, cut to size", async () => {
    const server = fakeMcpServer({
      requireAuthorization: "Bearer key-123",
      tools: [
        {
          name: "search_issues",
          description: "x".repeat(MCP_TOOL_DESCRIPTION_MAX_CHARS + 50),
          annotations: { readOnlyHint: true },
        },
        { name: "create_issue", description: "Opens an issue" },
        {
          name: "huge_schema",
          inputSchema: {
            type: "object",
            properties: { blob: { description: "y".repeat(9_000) } },
          },
        },
      ],
    });

    const tools = await listMcpServerTools(target, server.fetch);

    expect(tools.map((tool) => [tool.name, tool.readOnlyHint])).toEqual([
      ["search_issues", true],
      ["create_issue", false],
      ["huge_schema", false],
    ]);
    expect(tools[0]?.description).toHaveLength(
      MCP_TOOL_DESCRIPTION_MAX_CHARS + 1,
    );
    expect(tools[1]?.inputSchema).toMatchObject({ type: "object" });
    expect(tools[2]?.inputSchema).toBeNull();
    expect(
      server.requests.every(
        (request) => request.headers.authorization === "Bearer key-123",
      ),
    ).toBe(true);
  });

  it("runs a tool with its arguments and returns the text", async () => {
    const server = fakeMcpServer({
      tools: [
        {
          name: "echo",
          run: (args) => ({ text: `said ${String(args.words)}` }),
        },
      ],
    });

    expect(
      await callMcpServerTool(target, "echo", { words: "hello" }, server.fetch),
    ).toEqual({ isError: false, text: "said hello" });
  });

  it("returns a tool's own failure instead of throwing, and cuts a long result", async () => {
    const server = fakeMcpServer({
      tools: [
        {
          name: "broken",
          run: () => ({ text: "No such repo", isError: true }),
        },
        { name: "long", run: () => ({ text: "z".repeat(40_000) }) },
      ],
    });

    expect(await callMcpServerTool(target, "broken", {}, server.fetch)).toEqual(
      { isError: true, text: "No such repo" },
    );
    const long = await callMcpServerTool(target, "long", {}, server.fetch);
    expect(long.text.length).toBeLessThan(MCP_RESULT_MAX_CHARS + 200);
    expect(long.text).toContain("[Cut: the result was 40000 characters");
  });

  it("throws when the server refuses the credential", async () => {
    const server = fakeMcpServer({
      requireAuthorization: "Bearer other",
      tools: [],
    });
    await expect(listMcpServerTools(target, server.fetch)).rejects.toThrow();
  });

  it("refuses a server on a private address through the guarded fetch", async () => {
    for (const url of ["https://127.0.0.1/mcp", "https://10.0.0.5/mcp"])
      await expect(listMcpServerTools({ url })).rejects.toThrow();
  });
});
