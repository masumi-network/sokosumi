import type { CallToolResult } from "@modelcontextprotocol/server";
import { createError } from "evlog";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { tryUseLogger } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import {
  type AuthenticationContext,
  preAuthenticatedRequests,
} from "@/middleware/auth";
import apiV1 from "@/routes/v1/index";

import type { ToolInput } from "./tool-schema";

const SERVER_ERROR_MESSAGE = "Sokosumi could not complete this request.";

/** Who a tool call acts for, and the MCP request it belongs to. */
export interface ToolCaller {
  authContext: AuthenticationContext;
  /** Core's origin as the caller reached it. */
  origin: string;
  /** The MCP request's id, carried into `/v1` so logs and errors share it. */
  requestId: string;
}

/**
 * `/v1` as Core serves it, without the prefix: the error envelope, the 404
 * for an unknown route and a request id (read from `X-Request-Id`, which only
 * `callTool` sets) come from the main app there, so this wrapper adds them
 * back.
 */
export const coreV1 = new Hono().use(requestId()).route("/", apiV1);
coreV1.onError(errorHandler);
coreV1.notFound((c) =>
  errorHandler(notFound("Not Found", { kind: "route_not_found" }), c),
);

/**
 * A workspace slug as Core creates them, and safe in a header: `Headers.set`
 * throws on a newline or a character above U+00FF.
 */
const SLUG = /^[a-z0-9][a-z0-9_-]{0,99}$/i;

/**
 * Runs a tool call as a `/v1` request, in process: `authMiddleware` takes
 * the caller from `preAuthenticatedRequests`, so every guard, organization
 * check and validation `/v1` applies still applies. A route that needs an
 * interactive session still answers 403.
 */
export async function callTool(
  input: ToolInput,
  args: Record<string, unknown>,
  caller: ToolCaller,
): Promise<CallToolResult> {
  const problem = argumentProblem(input, args);
  if (problem) {
    return toolError({ status: 422, message: problem });
  }

  try {
    const request = buildRequest(input, args, caller);
    preAuthenticatedRequests.set(request, {
      isAuthenticated: true,
      authContext: caller.authContext,
    });
    return await toToolResult(await coreV1.fetch(request), caller.requestId);
  } catch (error) {
    // `/v1` answers its own errors, so this is a fault in building the call.
    tryUseLogger()?.error(
      createError({
        message: "An MCP tool call failed before Core answered it",
        why: "Building or sending the /v1 request threw",
        fix: "failure names the error; the tool name is on the event.",
      }),
      { failure: messageSafeErrorFields(error) },
    );
    return toolError({
      status: 500,
      message: SERVER_ERROR_MESSAGE,
      requestId: caller.requestId,
    });
  }
}

function argumentProblem(
  input: ToolInput,
  args: Record<string, unknown>,
): string | undefined {
  const known = Object.keys(input.inputSchema.properties as object);
  const unknown = Object.keys(args).find((name) => !known.includes(name));
  if (unknown !== undefined) {
    return `Unknown argument "${unknown}". This tool takes: ${known.join(", ")}.`;
  }
  if (
    args.workspace != null &&
    (typeof args.workspace !== "string" || !SLUG.test(args.workspace))
  ) {
    return 'Argument "workspace" must be a workspace slug.';
  }
  for (const name of input.pathParams) {
    const value = args[name];
    if (value === undefined || value === "") {
      return `Missing argument "${name}".`;
    }
    // `.` and `..` would make the URL resolve to another operation.
    if (
      (typeof value !== "string" && typeof value !== "number") ||
      value === "." ||
      value === ".."
    ) {
      return `Argument "${name}" must be an id.`;
    }
  }
  return undefined;
}

function buildRequest(
  input: ToolInput,
  args: Record<string, unknown>,
  caller: ToolCaller,
): Request {
  const path = input.path.replace(/\{([^}]+)\}/g, (_, name: string) =>
    encodeURIComponent(String(args[name])),
  );
  const url = new URL(path, caller.origin);
  for (const name of input.queryParams) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(
        name,
        typeof item === "object" ? JSON.stringify(item) : String(item),
      );
    }
  }

  const headers = new Headers({ "X-Request-Id": caller.requestId });
  if (typeof args.workspace === "string" && args.workspace) {
    headers.set("X-Organization-Slug", args.workspace);
  }
  const hasBody = input.hasBody && args.body !== undefined;
  if (hasBody) {
    headers.set("Content-Type", "application/json");
  }

  return new Request(url, {
    method: input.method,
    headers,
    ...(hasBody ? { body: JSON.stringify(args.body) } : {}),
  });
}

/** Success: Core's `data` and `pagination`. Failure: `isError` (parent SOKD-360, section 2). */
async function toToolResult(
  response: Response,
  requestId: string,
): Promise<CallToolResult> {
  const body = await readJsonObject(response);

  if (response.ok) {
    const meta = body.meta as { pagination?: unknown } | undefined;
    return toolResult({
      data: body.data ?? null,
      ...(meta?.pagination ? { pagination: meta.pagination } : {}),
    });
  }

  const status = response.status;
  if (status >= 500) {
    // Core's 5xx message can name internals; the request id finds the logs.
    return toolError({
      status,
      message: SERVER_ERROR_MESSAGE,
      requestId,
    });
  }

  const { error: _name, message, kind, meta: _meta, ...details } = body;
  return toolError({
    status,
    ...(typeof kind === "string" ? { kind } : {}),
    message: typeof message === "string" ? message : response.statusText,
    // Such as `retryAfterSeconds` on a 429.
    ...(Object.keys(details).length > 0 ? { details } : {}),
  });
}

async function readJsonObject(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toolResult(structuredContent: Record<string, unknown>) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
  };
}

function toolError(error: Record<string, unknown>): CallToolResult {
  return { ...toolResult(error), isError: true };
}
