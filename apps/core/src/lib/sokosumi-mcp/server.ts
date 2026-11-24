import {
  ProtocolError,
  ProtocolErrorCode,
  Server,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";

import { callTool, type ToolCaller } from "./dispatch";
import { type DerivedTool, getTools } from "./tool-schema";

const INSTRUCTIONS =
  "Sokosumi tools act on the signed-in person's Sokosumi account. Call workspaces_list first: a tool acts in the personal workspace unless you pass an organization workspace's slug as `workspace`.";

/**
 * A fresh, stateless MCP server for one HTTP request, acting for `caller`.
 * Every tool call runs as a `/v1` request (`dispatch.ts`).
 */
export function createSokosumiMcpServer(caller: ToolCaller): Server {
  const server = new Server(
    { name: "sokosumi", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  const tools = getTools();

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

function annotations({ input, destructive }: DerivedTool): ToolAnnotations {
  if (input.method === "GET") {
    return { readOnlyHint: true, openWorldHint: false };
  }
  return {
    readOnlyHint: false,
    destructiveHint: destructive ?? input.method === "DELETE",
    idempotentHint: input.method === "PUT" || input.method === "DELETE",
    openWorldHint: false,
  };
}
