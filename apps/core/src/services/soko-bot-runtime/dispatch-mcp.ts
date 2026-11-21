import {
  sokoBotListMcpToolsInputSchema,
  sokoBotRunMcpToolInputSchema,
} from "@sokosumi/soko-bot";
import { callMcpServerTool } from "@/clients/mcp.client";
import prisma from "@/lib/db/prisma";
import { evalMcpFetch } from "@/lib/evals/eval-mcp-server";
import {
  isOwnerDirected,
  RuntimeEventLog,
  runtimeEvent,
  WEB_TAINT_EVENT,
} from "@/lib/soko-bot/turn-loop";
import {
  mcpServerTarget,
  parseSokoBotMcpTools,
  type SokoBotMcpTool,
} from "@/services/soko-bot-mcp.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRefusedUnsentError,
} from "../soko-bot-runtime.service";

/** Tools one search shows; a server can carry hundreds. */
export const MCP_TOOLS_PER_SEARCH = 20;

export function mcpTaintSource(serverId: string): string {
  return `mcp:${serverId}`;
}

/** Tools whose name or description has any of the query's words. */
export function searchMcpTools(
  tools: SokoBotMcpTool[],
  query?: string,
): SokoBotMcpTool[] {
  const words = (query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
  const matching = words.length
    ? tools.filter((tool) => {
        const text = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
        return words.some((word) => text.includes(word));
      })
    : tools;
  return matching.slice(0, MCP_TOOLS_PER_SEARCH);
}

async function findServer(sokoBotId: string, name: string) {
  const servers = await prisma.sokoBotMcpServer.findMany({
    where: { sokoBotId },
  });
  const server = servers.find(
    (entry) => entry.name.toLowerCase() === name.trim().toLowerCase(),
  );
  if (!server)
    throw new SokoBotRefusedUnsentError(
      `No MCP server named ${name}; list_mcp_tools without a server lists them`,
    );
  return server;
}

/** What else the turn read from outside Sokosumi, by source. */
async function untrustedSources(turnId: string): Promise<string[]> {
  const events = await prisma.sokoBotRuntimeEvent.findMany({
    where: { turnId, type: WEB_TAINT_EVENT },
    select: { data: true },
  });
  return events.map((event) => {
    const source = (event.data as { source?: unknown } | null)?.source;
    return typeof source === "string" ? source : "unknown";
  });
}

/**
 * A write to an MCP server runs on the owner's word only: in a turn they
 * typed, or a background run they started, and when nothing but this server
 * has put outside text into the turn. "Read the issue, then comment on it" is
 * one request; a web page must not pick what gets written.
 */
async function assertMcpWriteAllowed(turnId: string, serverId: string) {
  if (!(await isOwnerDirected(turnId)))
    throw new SokoBotRefusedUnsentError(
      "Core did not run it: an MCP tool that changes something runs only on a turn the owner started in their chat. Nothing was sent to the server. Say what you would do and ask the owner in chat.",
    );
  const own = mcpTaintSource(serverId);
  if ((await untrustedSources(turnId)).some((source) => source !== own))
    throw new SokoBotRefusedUnsentError(
      "Core did not run it: this turn also read the web, a file or another server, so it cannot change anything on this one. Nothing was sent to the server. Say what you would do and ask the owner in chat.",
    );
}

async function markRead(
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
  serverId: string,
) {
  const source = mcpTaintSource(serverId);
  if ((await untrustedSources(authorized.turn.id)).includes(source)) return;
  await new RuntimeEventLog(authorized.turn.id, input.sessionId).append(
    runtimeEvent(WEB_TAINT_EVENT, { source }),
  );
}

export async function dispatchMcpTools(
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  const sokoBotId = authorized.turn.sokoBotId;
  if (input.capability === "list_mcp_tools") {
    const parsed = sokoBotListMcpToolsInputSchema.parse(input.input);
    if (!parsed.server) {
      const servers = await prisma.sokoBotMcpServer.findMany({
        where: { sokoBotId },
        select: { name: true, tools: true },
        orderBy: { createdAt: "asc" },
      });
      return {
        servers: servers.map((server) => ({
          name: server.name,
          tools: parseSokoBotMcpTools(server.tools).filter(
            (tool) => tool.enabled,
          ).length,
        })),
      };
    }
    const server = await findServer(sokoBotId, parsed.server);
    // Descriptions are the server's words, so they count as outside input.
    await markRead(input, authorized, server.id);
    const enabled = parseSokoBotMcpTools(server.tools).filter(
      (tool) => tool.enabled,
    );
    const tools = searchMcpTools(enabled, parsed.query);
    return {
      server: server.name,
      // Named like functions, so a model calls them directly unless told.
      how: `These are ${server.name}'s tools, not yours: call one with read_mcp_tool or run_mcp_tool (callWith), passing server "${server.name}", tool and arguments.`,
      tools: tools.map(({ enabled: _enabled, ...tool }) => ({
        ...tool,
        callWith: tool.readOnly ? "read_mcp_tool" : "run_mcp_tool",
      })),
      ...(tools.length === 0 && parsed.query
        ? {
            note: "No tool matches these words. Search with other words, or without a query.",
          }
        : {}),
    };
  }

  const parsed = sokoBotRunMcpToolInputSchema.parse(input.input);
  const server = await findServer(sokoBotId, parsed.server);
  const tool = parseSokoBotMcpTools(server.tools).find(
    (entry) => entry.name === parsed.tool && entry.enabled,
  );
  if (!tool)
    throw new SokoBotRefusedUnsentError(
      `${server.name} has no switched-on tool named ${parsed.tool}; list_mcp_tools lists them`,
    );
  if (input.capability === "read_mcp_tool" && !tool.readOnly)
    throw new SokoBotRefusedUnsentError(
      `${tool.name} changes things, so it runs through run_mcp_tool`,
    );
  if (input.capability === "run_mcp_tool")
    await assertMcpWriteAllowed(authorized.turn.id, server.id);
  await markRead(input, authorized, server.id);
  const result = await callMcpServerTool(
    await mcpServerTarget(server),
    tool.name,
    parsed.arguments ?? {},
    (await evalMcpFetch(server.url, authorized.turn.workspaceId)) ?? undefined,
  ).catch(() => {
    // The cause can quote the server's reply; the bot gets the plain fact.
    throw new SokoBotRefusedUnsentError(
      `${server.name} did not answer the call; try again later or tell the owner`,
    );
  });
  return {
    server: server.name,
    tool: tool.name,
    trust: "untrusted-data",
    isError: result.isError,
    result: result.text,
  };
}
