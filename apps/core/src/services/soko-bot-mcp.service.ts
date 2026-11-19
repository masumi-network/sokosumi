import type { Prisma } from "@sokosumi/database";
import { z } from "zod";
import {
  listMcpServerTools,
  type McpServerTarget,
  type McpServerTool,
} from "@/clients/mcp.client";
import prisma from "@/lib/db/prisma";
import {
  openSokoBotSecret,
  sealSokoBotSecret,
} from "@/lib/soko-bot/secret-box";
import { sokoBotMcpToolSchema } from "@/schemas/soko-bot-mcp.schema";

/** Enough for the handful of services an owner works with. */
export const SOKO_BOT_MCP_SERVER_LIMIT = 5;

export class SokoBotMcpError extends Error {}

export type SokoBotMcpTool = z.infer<typeof sokoBotMcpToolSchema>;

export type SokoBotMcpAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "header"; name: string; value: string };

type Fetch = typeof globalThis.fetch;

const serverSelect = {
  id: true,
  name: true,
  url: true,
  authKind: true,
  tools: true,
  toolsRefreshedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** The tools as a JSON column takes them; `inputSchema` is JSON from the server. */
export function sokoBotMcpToolsJson(
  tools: SokoBotMcpTool[],
): Prisma.InputJsonValue {
  return tools as Prisma.InputJsonValue;
}

export function parseSokoBotMcpTools(
  value: Prisma.JsonValue,
): SokoBotMcpTool[] {
  return z.array(sokoBotMcpToolSchema).parse(value);
}

function present<T extends { tools: Prisma.JsonValue }>(server: T) {
  return { ...server, tools: parseSokoBotMcpTools(server.tools) };
}

/** `https://` only; `ssrfSafeFetch` refuses private hosts at connect time. */
function publicServerUrl(raw: string): string {
  if (!URL.canParse(raw))
    throw new SokoBotMcpError("Enter the server's full https:// address");
  const url = new URL(raw);
  if (url.protocol !== "https:")
    throw new SokoBotMcpError("An MCP server needs an https:// address");
  if (url.username || url.password)
    throw new SokoBotMcpError(
      "Leave the key out of the address and enter it as the API key",
    );
  return url.href;
}

function authHeaders(auth: SokoBotMcpAuth): Record<string, string> {
  if (auth.type === "bearer") return { Authorization: `Bearer ${auth.token}` };
  if (auth.type === "header") return { [auth.name]: auth.value };
  return {};
}

/** Where to call a stored server, with its credential opened. */
export async function mcpServerTarget(server: {
  url: string;
  credentialCiphertext: string | null;
  credentialKeyId: string | null;
}): Promise<McpServerTarget> {
  if (!server.credentialCiphertext || !server.credentialKeyId)
    return { url: server.url };
  const headers = z.record(z.string(), z.string()).parse(
    JSON.parse(
      await openSokoBotSecret({
        ciphertext: server.credentialCiphertext,
        keyId: server.credentialKeyId,
      }),
    ),
  );
  return { url: server.url, headers };
}

/**
 * A fresh tool list merged with what the owner already decided. A tool seen
 * before keeps its switch and label. A new one takes the server's hint as its
 * label and is on only when the server is being added: a server must not grow
 * a new power on its own later.
 */
export function mergeMcpTools(
  listed: McpServerTool[],
  known: SokoBotMcpTool[] | null,
): SokoBotMcpTool[] {
  return listed.map((tool) => {
    const before = known?.find((entry) => entry.name === tool.name);
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      readOnly: before?.readOnly ?? tool.readOnlyHint,
      enabled: before?.enabled ?? known === null,
    };
  });
}

async function readTools(target: McpServerTarget, fetch?: Fetch) {
  try {
    return await listMcpServerTools(target, fetch);
  } catch {
    // The cause can quote the server's reply, so it stays out of the message.
    throw new SokoBotMcpError(
      "Could not read the server's tools. Check the address and the key, and that it is a remote MCP server (Streamable HTTP).",
    );
  }
}

/** The bot's MCP servers as `list_integrations` names them to the bot. */
export async function listMcpServersForBot(sokoBotId: string) {
  const servers = await prisma.sokoBotMcpServer.findMany({
    where: { sokoBotId },
    select: { name: true, tools: true },
    orderBy: { createdAt: "asc" },
  });
  return servers.map((server) => ({
    provider: "mcp",
    name: server.name,
    status: "ACTIVE",
    tools: parseSokoBotMcpTools(server.tools).filter((tool) => tool.enabled)
      .length,
    use: `list_mcp_tools with server "${server.name}"`,
  }));
}

export async function listSokoBotMcpServers(sokoBotId: string) {
  const servers = await prisma.sokoBotMcpServer.findMany({
    where: { sokoBotId },
    select: serverSelect,
    orderBy: { createdAt: "asc" },
  });
  return servers.map(present);
}

/** Connects, reads the tools and stores the server with all of them on. */
export async function addSokoBotMcpServer(
  input: {
    sokoBotId: string;
    userId: string;
    name: string;
    url: string;
    auth: SokoBotMcpAuth;
  },
  fetch?: Fetch,
) {
  const url = publicServerUrl(input.url);
  const taken = await prisma.sokoBotMcpServer.findMany({
    where: { sokoBotId: input.sokoBotId },
    select: { name: true },
  });
  if (taken.length >= SOKO_BOT_MCP_SERVER_LIMIT)
    throw new SokoBotMcpError(
      `A Soko Bot connects to up to ${SOKO_BOT_MCP_SERVER_LIMIT} MCP servers; remove one first`,
    );
  if (
    taken.some(
      (server) => server.name.toLowerCase() === input.name.toLowerCase(),
    )
  )
    throw new SokoBotMcpError("This bot already has a server by that name");

  const headers = authHeaders(input.auth);
  const tools = mergeMcpTools(await readTools({ url, headers }, fetch), null);
  const sealed =
    input.auth.type === "none"
      ? null
      : await sealSokoBotSecret(JSON.stringify(headers));
  const server = await prisma.sokoBotMcpServer.create({
    data: {
      sokoBotId: input.sokoBotId,
      createdByUserId: input.userId,
      name: input.name,
      url,
      authKind: input.auth.type === "none" ? "none" : "header",
      credentialCiphertext: sealed?.ciphertext ?? null,
      credentialKeyId: sealed?.keyId ?? null,
      tools: sokoBotMcpToolsJson(tools),
      toolsRefreshedAt: new Date(),
    },
    select: serverSelect,
  });
  return present(server);
}

/** Reads the tools again; a failure is kept on the row and thrown. */
export async function refreshSokoBotMcpServer(
  sokoBotId: string,
  serverId: string,
  fetch?: Fetch,
) {
  const server = await prisma.sokoBotMcpServer.findFirst({
    where: { id: serverId, sokoBotId },
  });
  if (!server) return null;
  let listed: McpServerTool[];
  try {
    listed = await readTools(await mcpServerTarget(server), fetch);
  } catch (error) {
    if (error instanceof SokoBotMcpError)
      await prisma.sokoBotMcpServer.update({
        where: { id: server.id },
        data: { lastError: error.message },
      });
    throw error;
  }
  const updated = await prisma.sokoBotMcpServer.update({
    where: { id: server.id },
    data: {
      tools: sokoBotMcpToolsJson(
        mergeMcpTools(listed, parseSokoBotMcpTools(server.tools)),
      ),
      toolsRefreshedAt: new Date(),
      lastError: null,
    },
    select: serverSelect,
  });
  return present(updated);
}

/** Switches one tool on or off, or changes its label. */
export async function updateSokoBotMcpTool(
  sokoBotId: string,
  serverId: string,
  change: { name: string; enabled?: boolean; readOnly?: boolean },
) {
  return prisma.$transaction(async (tx) => {
    // Locked: two switches flipped at once must not overwrite each other.
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM soko_bot_mcp_server
      WHERE id = ${serverId}::uuid AND "sokoBotId" = ${sokoBotId}::uuid
      FOR UPDATE`;
    if (!row) return null;
    const server = await tx.sokoBotMcpServer.findUniqueOrThrow({
      where: { id: serverId },
      select: { tools: true },
    });
    const tools = parseSokoBotMcpTools(server.tools);
    const tool = tools.find((entry) => entry.name === change.name);
    if (!tool) throw new SokoBotMcpError("The server has no tool by that name");
    tool.enabled = change.enabled ?? tool.enabled;
    tool.readOnly = change.readOnly ?? tool.readOnly;
    const updated = await tx.sokoBotMcpServer.update({
      where: { id: serverId },
      data: { tools: sokoBotMcpToolsJson(tools) },
      select: serverSelect,
    });
    return present(updated);
  });
}

export async function removeSokoBotMcpServer(
  sokoBotId: string,
  serverId: string,
): Promise<boolean> {
  const removed = await prisma.sokoBotMcpServer.deleteMany({
    where: { id: serverId, sokoBotId },
  });
  return removed.count > 0;
}
