import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  coworkerApiKeySchema,
  updateCoworkerApiKeyRequestSchema,
} from "@/schemas/coworker-api-key.schema";

import { requireCoworkerManagementAccess } from "../../admin-guard";
import { apiKeyParamsSchema } from "../schema";

const route = createRoute({
  method: "patch",
  path: "/{id}/api-keys/{keyId}",
  description: "Update coworker API key metadata",
  tags: ["Coworkers"],
  request: {
    params: apiKeyParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateCoworkerApiKeyRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(coworkerApiKeySchema, "Update coworker API key"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id, keyId } = c.req.valid("param");
    await requireCoworkerManagementAccess(c.var.authContext, id);
    const body = c.req.valid("json");

    const apiKey = await prisma.$transaction(async (tx) => {
      const updatedResult = await tx.coworkerApiKey.updateMany({
        where: {
          id: keyId,
          coworkerId: id,
          coworker: {
            archivedAt: null,
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

      if (updatedResult.count === 0) {
        throw notFound("Coworker API key not found");
      }

      const updatedKey = await tx.coworkerApiKey.findFirst({
        where: {
          id: keyId,
          coworkerId: id,
          coworker: {
            archivedAt: null,
          },
        },
        select: {
          id: true,
          coworkerId: true,
          name: true,
          keyStart: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!updatedKey) {
        throw notFound("Coworker API key not found");
      }

      return updatedKey;
    });

    return ok(c, coworkerApiKeySchema.parse(apiKey));
  });
}
