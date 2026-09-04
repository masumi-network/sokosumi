import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created, ok } from "@/helpers/response";
import {
  generateSokoBotApiKeyToken,
  hashApiKey,
  SOKO_BOT_API_KEY_START_LENGTH,
} from "@/lib/coworker-api-key";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  requireInteractiveUserAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import {
  createCoworkerApiKeyRequestSchema,
  updateCoworkerApiKeyRequestSchema,
} from "@/schemas/coworker-api-key.schema";
import {
  createSokoBotApiKeyResponseSchema,
  sokoBotApiKeySchema,
} from "@/schemas/soko-bot-api-key.schema";

const botParamsSchema = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path" },
    example: "01960001-0001-7001-8001-000000000099",
  }),
});

const keyParamsSchema = botParamsSchema.extend({
  keyId: z.string().openapi({
    param: { name: "keyId", in: "path" },
    example: "agentkey_123",
  }),
});

const apiKeySelect = {
  id: true,
  sokoBotId: true,
  name: true,
  keyStart: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const listRoute = createRoute({
  method: "get",
  path: "/{id}/api-keys",
  tags: ["Soko Bots"],
  request: { params: botParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      z.array(sokoBotApiKeySchema),
      "Retrieve Soko Bot API keys",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

const createRouteDefinition = createRoute({
  method: "post",
  path: "/{id}/api-keys",
  tags: ["Soko Bots"],
  request: {
    params: botParamsSchema,
    body: {
      content: {
        "application/json": { schema: createCoworkerApiKeyRequestSchema },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      createSokoBotApiKeyResponseSchema,
      "Create Soko Bot API key",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

const updateRoute = createRoute({
  method: "patch",
  path: "/{id}/api-keys/{keyId}",
  tags: ["Soko Bots"],
  request: {
    params: keyParamsSchema,
    body: {
      content: {
        "application/json": { schema: updateCoworkerApiKeyRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotApiKeySchema, "Update Soko Bot API key"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

const revokeRoute = createRoute({
  method: "delete",
  path: "/{id}/api-keys/{keyId}",
  tags: ["Soko Bots"],
  request: { params: keyParamsSchema },
  responses: {
    200: jsonSuccessResponse(sokoBotApiKeySchema, "Revoke Soko Bot API key"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export function mountSokoBotApiKeyRoutes(app: OpenAPIHonoWithAuth): void {
  app.openapi(listRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const bot = await prisma.sokoBot.findFirst({
      where: {
        id,
        userId: auth.userId,
        archivedAt: null,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!bot) {
      throw notFound("Soko Bot not found");
    }

    const keys = await prisma.coworkerApiKey.findMany({
      where: {
        sokoBotId: id,
        sokoBot: {
          userId: auth.userId,
          archivedAt: null,
          deletedAt: null,
        },
      },
      select: apiKeySelect,
      orderBy: { createdAt: "desc" },
    });
    return ok(c, z.array(sokoBotApiKeySchema).parse(keys));
  });

  app.openapi(createRouteDefinition, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const token = generateSokoBotApiKeyToken();
    const keyHash = await hashApiKey(token);
    const keyStart = token.slice(0, SOKO_BOT_API_KEY_START_LENGTH);

    const apiKey = await prisma.$transaction(async (tx) => {
      const bot = await tx.sokoBot.findFirst({
        where: {
          id,
          userId: auth.userId,
          archivedAt: null,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!bot) {
        throw notFound("Soko Bot not found");
      }

      return await tx.coworkerApiKey.create({
        data: {
          coworkerId: null,
          sokoBotId: id,
          name: body.name ?? null,
          keyHash,
          keyStart,
          expiresAt: body.expiresAt == null ? null : new Date(body.expiresAt),
          revokedAt: null,
        },
        select: { id: true, name: true, expiresAt: true },
      });
    });

    return created(
      c,
      createSokoBotApiKeyResponseSchema.parse({ ...apiKey, token }),
    );
  });

  app.openapi(updateRoute, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id, keyId } = c.req.valid("param");
    const body = c.req.valid("json");
    const apiKey = await prisma.$transaction(async (tx) => {
      const updated = await tx.coworkerApiKey.updateMany({
        where: {
          id: keyId,
          sokoBotId: id,
          sokoBot: {
            userId: auth.userId,
            archivedAt: null,
            deletedAt: null,
          },
        },
        data: {
          name: body.name,
          expiresAt:
            body.expiresAt === undefined
              ? undefined
              : body.expiresAt === null
                ? null
                : new Date(body.expiresAt),
        },
      });
      if (updated.count === 0) {
        throw notFound("Soko Bot API key not found");
      }
      return await tx.coworkerApiKey.findFirst({
        where: { id: keyId, sokoBotId: id },
        select: apiKeySelect,
      });
    });

    if (!apiKey) {
      throw notFound("Soko Bot API key not found");
    }
    return ok(c, sokoBotApiKeySchema.parse(apiKey));
  });

  app.openapi(revokeRoute, async (c) => {
    const auth = requireInteractiveUserAuthContext(c.var.authContext);
    const { id, keyId } = c.req.valid("param");
    const apiKey = await prisma.$transaction(async (tx) => {
      const revokedAt = new Date();
      await tx.coworkerApiKey.updateMany({
        where: {
          id: keyId,
          sokoBotId: id,
          revokedAt: null,
          sokoBot: {
            userId: auth.userId,
            archivedAt: null,
            deletedAt: null,
          },
        },
        data: { revokedAt },
      });
      return await tx.coworkerApiKey.findFirst({
        where: {
          id: keyId,
          sokoBotId: id,
          sokoBot: {
            userId: auth.userId,
            archivedAt: null,
            deletedAt: null,
          },
        },
        select: apiKeySelect,
      });
    });

    if (!apiKey) {
      throw notFound("Soko Bot API key not found");
    }
    return ok(c, sokoBotApiKeySchema.parse(apiKey));
  });
}
