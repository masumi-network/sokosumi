import {
  ProtocolError,
  ProtocolErrorCode,
  Server,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";

import { callTool, type ToolCaller } from "./dispatch";
import { type DerivedTool, getTools } from "./tool-schema";
import { MCP_TOOLSETS, toolsetOf } from "./tools";

/** What the agent reads first: the workspace rule and the toolsets. */
export function instructions(toolsets: readonly string[]): string {
  const others = MCP_TOOLSETS.filter((name) => !toolsets.includes(name));
  return [
    "Sokosumi tools act on the signed-in person's Sokosumi account.",
    toolsets.includes("workspaces")
      ? "Call workspaces_list first: a tool acts in the personal workspace unless you pass an organization workspace's slug as `workspace`."
      : "A tool acts in the personal workspace unless you pass an organization workspace's slug as `workspace`; ask the person for it, or for the workspaces toolset.",
    `Toolsets on: ${toolsets.join(", ")}.`,
    ...(toolsets.includes("tasks")
      ? [
          "tasks_get takes a Task's identifier, such as SOK-12. Other tasks tools take a Task's `id` from tasks_get or tasks_list.",
        ]
      : []),
    ...(others.length > 0
      ? [
          `Off: ${others.join(", ")}. The person turns toolsets on with ?toolsets= on the server URL, comma-separated.`,
        ]
      : []),
  ].join(" ");
}

/**
 * A fresh, stateless MCP server for one HTTP request, acting for `caller`,
 * with the tools in `toolsets` (`tools.ts`). Every tool call runs as a `/v1`
 * request (`dispatch.ts`).
 */
export function createSokosumiMcpServer(
  caller: ToolCaller,
  toolsets: readonly string[],
): Server {
  const server = new Server(
    { name: "sokosumi", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: instructions(toolsets) },
  );
  const tools = new Map(
    [...getTools()].filter(([name]) => toolsets.includes(toolsetOf(name))),
  );

  server.setRequestHandler("tools/list", () => ({
    tools: [...tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input.inputSchema,
      annotations: annotations(tool),
    })),
  }));

  server.setRequestHandler("tools/call", ({ params }) => {
    const tool = tools.get(params.name);
    if (!tool) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Unknown tool: ${params.name}`,
      );
    }
    return callTool(tool.input, params.arguments ?? {}, caller);
  });

  return server;
}

function annotations({
  input,
  destructive,
  spendsCredits = false,
  openWorld = false,
}: DerivedTool): ToolAnnotations {
  if (input.method === "GET") {
    return { readOnlyHint: true, openWorldHint: false };
  }
  return {
    readOnlyHint: false,
    destructiveHint:
      spendsCredits || (destructive ?? input.method === "DELETE"),
    idempotentHint: input.method === "PUT" || input.method === "DELETE",
    // Credits pay an outside agent; ad tools act on Google or Meta.
    openWorldHint: spendsCredits || openWorld,
  };
}
