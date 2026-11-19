import {
  type CallToolResult,
  createMCPClient,
  type ListToolsResult,
  type OAuthClientProvider,
} from "@ai-sdk/mcp";
import { ssrfSafeFetch } from "@sokosumi/net";

/** Where Core calls an MCP server, and the headers that carry its credential. */
export interface McpServerTarget {
  url: string;
  headers?: Record<string, string>;
  /** A server the owner signed in to: tokens come from, and go back to, Core. */
  authProvider?: OAuthClientProvider;
}

/** One tool as a server lists it, cut to what a turn can afford. */
export interface McpServerTool {
  name: string;
  description: string | null;
  inputSchema: unknown;
  /** The server's own `readOnlyHint`; untrusted, so only a first label. */
  readOnlyHint: boolean;
}

export interface McpToolResult {
  isError: boolean;
  text: string;
}

export const MCP_TOOLS_PER_SERVER = 200;
export const MCP_TOOL_DESCRIPTION_MAX_CHARS = 1_000;
export const MCP_TOOL_SCHEMA_MAX_CHARS = 8_000;
export const MCP_RESULT_MAX_CHARS = 30_000;
/** A call the model is waiting on, as for Composio. */
export const MCP_TIMEOUT_MS = 45_000;
const MCP_RESPONSE_MAX_BYTES = 1_000_000;

type Fetch = typeof globalThis.fetch;

function headerRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}

/**
 * The fetch every MCP request goes through: public addresses only, a bounded
 * body, and no redirects for anything that carries the credential.
 *
 * It answers the transport's own GET on the server URL with 405. That GET
 * asks for a stream that stays open, and `ssrfSafeFetch` reads a whole body;
 * the spec lets a server refuse it, and the client then works without.
 */
export function guardedFetch(
  target: { url: string },
  signal: AbortSignal,
): Fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url === new URL(target.url).href)
      return new Response(null, { status: 405 });
    const body = init?.body;
    return ssrfSafeFetch(url, {
      method,
      headers: headerRecord(init?.headers),
      // OAuth token and registration requests send a form or JSON.
      body:
        typeof body === "string"
          ? body
          : body instanceof URLSearchParams
            ? body.toString()
            : undefined,
      signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
      maxResponseBytes: MCP_RESPONSE_MAX_BYTES,
    });
  };
}

async function withMcpClient<T>(
  target: McpServerTarget,
  run: (client: Awaited<ReturnType<typeof createMCPClient>>) => Promise<T>,
  fetch?: Fetch,
): Promise<T> {
  const signal = AbortSignal.timeout(MCP_TIMEOUT_MS);
  const client = await createMCPClient({
    name: "sokosumi",
    transport: {
      type: "http",
      url: target.url,
      headers: target.headers,
      authProvider: target.authProvider,
      fetch: fetch ?? guardedFetch(target, signal),
    },
  });
  try {
    return await run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function describeTool(tool: ListToolsResult["tools"][number]): McpServerTool {
  const schema = JSON.stringify(tool.inputSchema ?? null);
  return {
    name: tool.name,
    description: tool.description
      ? clip(tool.description, MCP_TOOL_DESCRIPTION_MAX_CHARS)
      : null,
    // A schema too large to show is left out; the tool still runs.
    inputSchema:
      schema.length > MCP_TOOL_SCHEMA_MAX_CHARS ? null : tool.inputSchema,
    readOnlyHint: tool.annotations?.readOnlyHint === true,
  };
}

/** The server's tools, at most {@link MCP_TOOLS_PER_SERVER}. */
export function listMcpServerTools(
  target: McpServerTarget,
  fetch?: Fetch,
): Promise<McpServerTool[]> {
  return withMcpClient(
    target,
    async (client) => {
      const tools: McpServerTool[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(
          cursor ? { params: { cursor } } : undefined,
        );
        tools.push(...page.tools.map(describeTool));
        cursor = page.nextCursor;
      } while (cursor && tools.length < MCP_TOOLS_PER_SERVER);
      return tools.slice(0, MCP_TOOLS_PER_SERVER);
    },
    fetch,
  );
}

function resultText(result: CallToolResult): string {
  const parts: { type: string; text?: unknown }[] = Array.isArray(
    result.content,
  )
    ? result.content
    : [];
  // A server on the 2024-10-07 protocol answers with `toolResult` alone.
  if (parts.length === 0 && "toolResult" in result)
    return JSON.stringify(result.toolResult ?? "");
  const text = parts
    .map((part) =>
      part.type === "text" && typeof part.text === "string"
        ? part.text
        : `[${part.type} left out]`,
    )
    .join("\n");
  if (text) return text;
  return result.structuredContent === undefined
    ? ""
    : JSON.stringify(result.structuredContent);
}

/** Runs one tool. A tool's own failure comes back as `isError`, not a throw. */
export function callMcpServerTool(
  target: McpServerTarget,
  name: string,
  args: Record<string, unknown>,
  fetch?: Fetch,
): Promise<McpToolResult> {
  return withMcpClient(
    target,
    async (client) => {
      const result = await client.callTool({ name, arguments: args });
      const text = resultText(result);
      return {
        isError: result.isError === true,
        text:
          text.length > MCP_RESULT_MAX_CHARS
            ? `${text.slice(0, MCP_RESULT_MAX_CHARS)}\n[Cut: the result was ${text.length} characters. Ask for less, or page.]`
            : text,
      };
    },
    fetch,
  );
}
