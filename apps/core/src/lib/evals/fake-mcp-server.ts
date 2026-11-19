/**
 * An MCP server over Streamable HTTP, in process: a `fetch` to hand to the
 * MCP client instead of the network. Tests use it, and eval lanes talk to
 * one as their "Tracker" server (`eval-mcp-server.ts`). It answers `initialize`, `tools/list`
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
  /**
   * Be its own OAuth 2.1 authorization server, as the MCP spec describes:
   * protected resource and server metadata, registration, and a token
   * endpoint that hands out `access-1` for the code `code-1`.
   */
  oauth?: boolean;
}) {
  const requests: FakeMcpRequest[] = [];
  const tokenRequests: URLSearchParams[] = [];

  const answer = (id: unknown, body: Record<string, unknown>) =>
    Response.json({ jsonrpc: "2.0", id, ...body });

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const method = (init?.method ?? "GET").toUpperCase();
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (options.oauth) {
      const answered = oauthAnswer(url, method, init?.body);
      if (answered) return answered;
    }
    const message =
      typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({
      method,
      rpcMethod: message?.method ?? null,
      headers,
      params: message?.params,
    });
    const required =
      options.requireAuthorization ??
      (options.oauth ? "Bearer access-1" : undefined);
    if (required && headers.authorization !== required)
      return new Response("Unauthorized", {
        status: 401,
        headers: options.oauth
          ? {
              "www-authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource${url.pathname}"`,
            }
          : {},
      });
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

  function oauthAnswer(
    url: URL,
    method: string,
    body: unknown,
  ): Response | null {
    const origin = url.origin;
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
      return Response.json({
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
      });
    if (
      url.pathname === "/.well-known/oauth-authorization-server" ||
      url.pathname === "/.well-known/openid-configuration"
    )
      return Response.json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (url.pathname === "/register" && method === "POST")
      return Response.json(
        { ...JSON.parse(String(body)), client_id: "client-1" },
        { status: 201 },
      );
    if (url.pathname === "/token" && method === "POST") {
      const form = new URLSearchParams(String(body));
      tokenRequests.push(form);
      return form.get("code") === "code-1" ||
        form.get("refresh_token") === "refresh-1"
        ? Response.json({
            access_token: "access-1",
            token_type: "Bearer",
            refresh_token: "refresh-1",
            expires_in: 3600,
          })
        : Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    return null;
  }

  return { fetch, requests, tokenRequests };
}
