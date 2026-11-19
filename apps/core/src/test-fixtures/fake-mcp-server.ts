/**
 * An MCP server over Streamable HTTP, in process: a `fetch` to hand to the
 * MCP client instead of the network. It answers `initialize`, `tools/list`
 * and `tools/call`, and records every request it saw.
 */
export interface FakeMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  run?: (args: Record<string, unknown>) => {
    text: string;
    isError?: boolean;
  };
}

export interface FakeMcpRequest {
  method: string;
  rpcMethod: string | null;
  headers: Record<string, string>;
  params: unknown;
}

export function fakeMcpServer(options: {
  tools: FakeMcpTool[];
  /** Answer 401 unless this header value is sent as `authorization`. */
  requireAuthorization?: string;
}) {
  const requests: FakeMcpRequest[] = [];

  const answer = (id: unknown, body: Record<string, unknown>) =>
    Response.json({ jsonrpc: "2.0", id, ...body });

  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const method = (init?.method ?? "GET").toUpperCase();
    const message =
      typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({
      method,
      rpcMethod: message?.method ?? null,
      headers,
      params: message?.params,
    });
    if (
      options.requireAuthorization &&
      headers.authorization !== options.requireAuthorization
    )
      return new Response("Unauthorized", { status: 401 });
    if (method !== "POST" || !message)
      return new Response(null, { status: 405 });
    if (message.id === undefined) return new Response(null, { status: 202 });

    switch (message.method) {
      case "initialize":
        return answer(message.id, {
          result: {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fake-mcp", version: "1.0.0" },
          },
        });
      case "tools/list":
        return answer(message.id, {
          result: {
            tools: options.tools.map(({ run: _run, ...tool }) => ({
              inputSchema: { type: "object", properties: {} },
              ...tool,
            })),
          },
        });
      case "tools/call": {
        const tool = options.tools.find(
          (candidate) => candidate.name === message.params.name,
        );
        if (!tool)
          return answer(message.id, {
            error: { code: -32602, message: "Unknown tool" },
          });
        const result = tool.run?.(message.params.arguments ?? {}) ?? {
          text: "ok",
        };
        return answer(message.id, {
          result: {
            content: [{ type: "text", text: result.text }],
            isError: result.isError ?? false,
          },
        });
      }
      default:
        return answer(message.id, {
          error: { code: -32601, message: "Method not found" },
        });
    }
  };

  return { fetch, requests };
}
