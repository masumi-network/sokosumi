import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { hashApiKey } from "@/lib/api-key-hash";
import {
  COWORKER_API_KEY_START_LENGTH,
  generateCoworkerApiKeyToken,
} from "@/lib/coworker-api-key";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  createCoworkerApiKeyRequestSchema,
  createCoworkerApiKeyResponseSchema,
} from "@/schemas/coworker-api-key.schema";

import { requireCoworkerManagementAccess } from "../../coworker-management-access";
import { paramsSchema } from "../schema";

const route = createRoute({
  method: "post",
  path: "/{id}/api-keys",
  description: "Create coworker API key",
  tags: ["Coworkers"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: createCoworkerApiKeyRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      createCoworkerApiKeyResponseSchema,
      "Create coworker API key",
      {
        data: {
          id: "cokey_123",
          token: "coworker_super_secret_token",
          name: "Production key",
          expiresAt: "2026-12-31T23:59:59.000Z",
        },
        meta: {
          timestamp: "2026-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    await requireCoworkerManagementAccess(c.var.authContext, id);
    const body = c.req.valid("json");

    const token = generateCoworkerApiKeyToken();
    const keyHash = await hashApiKey(token);
    const keyStart = token.slice(0, COWORKER_API_KEY_START_LENGTH);

    const apiKey = await prisma.$transaction(async (tx) => {
      // UPDATE acquires a row lock so archive cannot interleave between check and create.
      const activeCoworkerCount = await tx.coworker.updateMany({
        where: {
          id,
          archivedAt: null,
        },
        data: {
          updatedAt: new Date(),
        },
      });

      if (activeCoworkerCount.count === 0) {
        throw notFound("Coworker not found");
      }

      return await tx.coworkerApiKey.create({
        data: {
          coworkerId: id,
          name: body.name ?? null,
          keyHash,
          keyStart,
          expiresAt:
            body.expiresAt === undefined || body.expiresAt === null
              ? null
              : new Date(body.expiresAt),
          revokedAt: null,
        },
        select: {
          id: true,
          name: true,
          expiresAt: true,
        },
      });
    });

    return created(
      c,
      createCoworkerApiKeyResponseSchema.parse({
        id: apiKey.id,
        token,
        name: apiKey.name,
        expiresAt: apiKey.expiresAt,
      }),
    );
  });
}
