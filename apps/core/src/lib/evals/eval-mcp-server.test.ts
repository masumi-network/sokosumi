import { describe, expect, it, vi } from "vitest";

import { callMcpServerTool, listMcpServerTools } from "@/clients/mcp.client";

vi.mock("@/lib/evals/eval-guard", () => ({
  isEvalWorkspace: async (workspaceId: string) => workspaceId === "eval-ws",
}));

import { EVAL_MCP_SERVER, evalMcpFetch } from "./eval-mcp-server";

describe("eval Tracker MCP server", () => {
  it("answers an eval workspace in process, with reads and writes told apart", async () => {
    const fetch = await evalMcpFetch(EVAL_MCP_SERVER.url, "eval-ws");
    expect(fetch).not.toBeNull();
    const target = { url: EVAL_MCP_SERVER.url };
    const tools = await listMcpServerTools(target, fetch ?? undefined);
    expect(tools.map((tool) => [tool.name, tool.readOnlyHint])).toEqual([
      ["search_issues", true],
      ["get_issue", true],
      ["add_comment", false],
      ["create_issue", false],
    ]);
    const found = await callMcpServerTool(
      target,
      "search_issues",
      { query: "checkout" },
      fetch ?? undefined,
    );
    expect(found.text).toContain("ISS-12");
  });

  it("is never used outside an eval workspace or for another address", async () => {
    expect(await evalMcpFetch(EVAL_MCP_SERVER.url, "customer-ws")).toBeNull();
    expect(
      await evalMcpFetch("https://mcp.example.test/mcp", "eval-ws"),
    ).toBeNull();
  });
});
