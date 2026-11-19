import { createRoute, z } from "@hono/zod-openapi";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import {
  saveSokoBotSecretRequestSchema,
  sokoBotSandboxSetupSchema,
  sokoBotSecretNameSchema,
  sokoBotSecretSchema,
} from "@/schemas/soko-bot-secret.schema";
import {
  deleteSokoBotSecret,
  listSokoBotSecrets,
  requireOwnedPersonalSokoBot,
  SokoBotSecretError,
  saveSokoBotSecret,
} from "@/services/soko-bot-secrets.service";

const botParamsSchema = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path" },
    example: "01960001-0001-7001-8001-000000000099",
  }),
});

const secretParamsSchema = botParamsSchema.extend({
  name: sokoBotSecretNameSchema.openapi({
    param: { name: "name", in: "path" },
  }),
});

const refusals = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
};

const listRoute = createRoute({
  method: "get",
  path: "/{id}/secrets",
  operationId: "listSokoBotSecrets",
  tags: ["Soko Bots"],
  request: { params: botParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      z.array(sokoBotSecretSchema),
      "The bot's saved keys, without their values",
    ),
    ...refusals,
  },
});

const saveRoute = createRoute({
  method: "put",
  path: "/{id}/secrets/{name}",
  operationId: "saveSokoBotSecret",
  tags: ["Soko Bots"],
  request: {
    params: secretParamsSchema,
    body: {
      content: {
        "application/json": { schema: saveSokoBotSecretRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotSecretSchema, "The saved key"),
    ...refusals,
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}/secrets/{name}",
  operationId: "deleteSokoBotSecret",
  tags: ["Soko Bots"],
  request: { params: secretParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      z.object({ deleted: z.literal(true) }),
      "The key is gone",
    ),
    ...refusals,
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

const getSetupRoute = createRoute({
  method: "get",
  path: "/{id}/sandbox-setup",
  operationId: "getSokoBotSandboxSetup",
  tags: ["Soko Bots"],
  request: { params: botParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      sokoBotSandboxSetupSchema,
      "Commands that run each time the bot's sandbox starts",
    ),
    ...refusals,
  },
});

const putSetupRoute = createRoute({
  method: "put",
  path: "/{id}/sandbox-setup",
  operationId: "setSokoBotSandboxSetup",
  tags: ["Soko Bots"],
  request: {
    params: botParamsSchema,
    body: {
      content: { "application/json": { schema: sokoBotSandboxSetupSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotSandboxSetupSchema, "The saved commands"),
    ...refusals,
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

/**
 * A personal bot's saved keys and sandbox setup (ADR 0074). Every route needs
 * the owner at the keyboard: an OAuth client or API key must not be able to
 * plant a key or a command the bot then runs.
 */
export function mountSokoBotSecretRoutes(app: OpenAPIHonoWithAuth): void {
  app.openapi(listRoute, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    await requireOwnedPersonalSokoBot(auth.userId, id);
    return ok(
      c,
      z.array(sokoBotSecretSchema).parse(await listSokoBotSecrets(id)),
    );
  });

  app.openapi(saveRoute, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id, name } = c.req.valid("param");
    await requireOwnedPersonalSokoBot(auth.userId, id);
    try {
      const secret = await saveSokoBotSecret({
        sokoBotId: id,
        userId: auth.userId,
        name,
        ...c.req.valid("json"),
      });
      return ok(c, sokoBotSecretSchema.parse(secret));
    } catch (error) {
      if (error instanceof SokoBotSecretError)
        throw unprocessableEntity(error.message);
      throw error;
    }
  });

  app.openapi(deleteRoute, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id, name } = c.req.valid("param");
    await requireOwnedPersonalSokoBot(auth.userId, id);
    if (!(await deleteSokoBotSecret(id, name))) throw notFound("Key not found");
    return ok(c, { deleted: true as const });
  });

  app.openapi(getSetupRoute, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    await requireOwnedPersonalSokoBot(auth.userId, id);
    const bot = await prisma.sokoBot.findUniqueOrThrow({
      where: { id },
      select: { sandboxSetupCommands: true },
    });
    return ok(c, { commands: bot.sandboxSetupCommands });
  });

  app.openapi(putSetupRoute, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    await requireOwnedPersonalSokoBot(auth.userId, id);
    const { commands } = c.req.valid("json");
    await prisma.sokoBot.update({
      where: { id },
      data: { sandboxSetupCommands: commands },
    });
    return ok(c, { commands });
  });
}
