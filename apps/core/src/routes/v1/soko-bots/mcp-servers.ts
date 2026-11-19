import { createRoute, z } from "@hono/zod-openapi";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import {
  addSokoBotMcpServerRequestSchema,
  sokoBotMcpServerSchema,
  updateSokoBotMcpToolRequestSchema,
} from "@/schemas/soko-bot-mcp.schema";
import {
  addSokoBotMcpServer,
  listSokoBotMcpServers,
  refreshSokoBotMcpServer,
  removeSokoBotMcpServer,
  SokoBotMcpError,
  updateSokoBotMcpTool,
} from "@/services/soko-bot-mcp.service";
import { requireOwnedPersonalSokoBot } from "@/services/soko-bot-secrets.service";

const botParamsSchema = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path" },
    example: "01960001-0001-7001-8001-000000000099",
  }),
});

const serverParamsSchema = botParamsSchema.extend({
  serverId: z.uuid().openapi({ param: { name: "serverId", in: "path" } }),
});

const refusals = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
  422: jsonErrorResponse("Unprocessable Entity"),
};

const listRoute = createRoute({
  method: "get",
  path: "/{id}/mcp-servers",
  operationId: "listSokoBotMcpServers",
  tags: ["Soko Bots"],
  request: { params: botParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      z.array(sokoBotMcpServerSchema),
      "The bot's MCP servers and their tools",
    ),
    ...refusals,
  },
});

const addRoute = createRoute({
  method: "post",
  path: "/{id}/mcp-servers",
  operationId: "addSokoBotMcpServer",
  tags: ["Soko Bots"],
  request: {
    params: botParamsSchema,
    body: {
      content: {
        "application/json": { schema: addSokoBotMcpServerRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      sokoBotMcpServerSchema,
      "The server, connected, with its tools",
    ),
    ...refusals,
  },
});

const refreshRoute = createRoute({
  method: "post",
  path: "/{id}/mcp-servers/{serverId}/refresh",
  operationId: "refreshSokoBotMcpServer",
  tags: ["Soko Bots"],
  request: { params: serverParamsSchema },
  responses: {
    200: jsonSuccessResponse(sokoBotMcpServerSchema, "The tools, read again"),
    ...refusals,
  },
});

const updateToolRoute = createRoute({
  method: "patch",
  path: "/{id}/mcp-servers/{serverId}/tools",
  operationId: "updateSokoBotMcpTool",
  tags: ["Soko Bots"],
  request: {
    params: serverParamsSchema,
    body: {
      content: {
        "application/json": { schema: updateSokoBotMcpToolRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotMcpServerSchema, "The changed server"),
    ...refusals,
  },
});

const removeRoute = createRoute({
  method: "delete",
  path: "/{id}/mcp-servers/{serverId}",
  operationId: "removeSokoBotMcpServer",
  tags: ["Soko Bots"],
  request: { params: serverParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      z.object({ removed: z.literal(true) }),
      "The server and its key are gone",
    ),
    ...refusals,
  },
});

function asUnprocessable(error: unknown): never {
  if (error instanceof SokoBotMcpError)
    throw unprocessableEntity(error.message);
  throw error;
}

/**
 * A personal bot's MCP servers (ADR 0074). The owner only, at the keyboard:
 * an OAuth client or API key must not be able to point the bot at a server.
 */
export function mountSokoBotMcpServerRoutes(
  app: OpenAPIHonoWithAuth,
  fetch?: typeof globalThis.fetch,
): void {
  app.openapi(listRoute, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    await requireOwnedPersonalSokoBot(auth.userId, id);
    return ok(
      c,
      z.array(sokoBotMcpServerSchema).parse(await listSokoBotMcpServers(id)),
    );
  });

  app.openapi(addRoute, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    await requireOwnedPersonalSokoBot(auth.userId, id);
    const server = await addSokoBotMcpServer(
      { sokoBotId: id, userId: auth.userId, ...c.req.valid("json") },
      fetch,
    ).catch(asUnprocessable);
    return ok(c, sokoBotMcpServerSchema.parse(server));
  });

  app.openapi(refreshRoute, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id, serverId } = c.req.valid("param");
    await requireOwnedPersonalSokoBot(auth.userId, id);
    const server = await refreshSokoBotMcpServer(id, serverId, fetch).catch(
      asUnprocessable,
    );
    if (!server) throw notFound("MCP server not found");
    return ok(c, sokoBotMcpServerSchema.parse(server));
  });

  app.openapi(updateToolRoute, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id, serverId } = c.req.valid("param");
    await requireOwnedPersonalSokoBot(auth.userId, id);
    const server = await updateSokoBotMcpTool(
      id,
      serverId,
      c.req.valid("json"),
    ).catch(asUnprocessable);
    if (!server) throw notFound("MCP server not found");
    return ok(c, sokoBotMcpServerSchema.parse(server));
  });

  app.openapi(removeRoute, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id, serverId } = c.req.valid("param");
    await requireOwnedPersonalSokoBot(auth.userId, id);
    if (!(await removeSokoBotMcpServer(id, serverId)))
      throw notFound("MCP server not found");
    return ok(c, { removed: true as const });
  });
}
