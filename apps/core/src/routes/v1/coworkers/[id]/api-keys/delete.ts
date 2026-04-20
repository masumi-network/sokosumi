import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { coworkerApiKeySchema } from "@/schemas/coworker-api-key.schema";

import { requireCoworkerManagementAccess } from "../../coworker-management-access";
import { apiKeyParamsSchema } from "../schema";

const route = createRoute({
  method: "delete",
  path: "/{id}/api-keys/{keyId}",
  description: "Revoke coworker API key",
  tags: ["Coworkers"],
  request: {
    params: apiKeyParamsSchema,
  },
  responses: {
    200: jsonSuccessResponse(coworkerApiKeySchema, "Revoke coworker API key"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id, keyId } = c.req.valid("param");
    await requireCoworkerManagementAccess(c.var.authContext, id);

    const apiKey = await prisma.$transaction(async (tx) => {
      const revokedAt = new Date();
      const revokeResult = await tx.coworkerApiKey.updateMany({
        where: {
          id: keyId,
          coworkerId: id,
          revokedAt: null,
          coworker: {
            archivedAt: null,
          },
        },
        data: {
          revokedAt,
        },
      });

      if (revokeResult.count > 0) {
        const revokedKey = await tx.coworkerApiKey.findFirst({
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

        if (!revokedKey) {
          throw notFound("Coworker API key not found");
        }

        return revokedKey;
      }

      const existingKey = await tx.coworkerApiKey.findFirst({
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

      if (!existingKey) {
        throw notFound("Coworker API key not found");
      }

      return existingKey;
    });

    return ok(c, coworkerApiKeySchema.parse(apiKey));
  });
}
