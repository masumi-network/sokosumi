import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { coworkerSchema } from "@/schemas/task.schema";

import { requireCoworkerAdminAuthContext } from "../admin-guard";
import { paramsSchema } from "./schema";

const route = createRoute({
  method: "delete",
  path: "/{id}",
  description: "Archive coworker and revoke active API keys (admin only)",
  tags: ["Coworkers"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(coworkerSchema, "Archive coworker"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    await requireCoworkerAdminAuthContext(c.var.authContext);

    const { id } = c.req.valid("param");

    const coworker = await prisma.$transaction(async (tx) => {
      const existingCoworker = await tx.coworker.findFirst({
        where: {
          id,
          archivedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (!existingCoworker) {
        throw notFound("Coworker not found");
      }

      const archivedAt = new Date();

      await tx.coworkerApiKey.updateMany({
        where: {
          coworkerId: id,
          revokedAt: null,
        },
        data: {
          revokedAt: archivedAt,
        },
      });

      return await tx.coworker.update({
        where: {
          id,
        },
        data: {
          archivedAt,
        },
      });
    });

    return ok(c, coworkerSchema.parse(coworker));
  });
}
