import { createRoute } from "@hono/zod-openapi";

import { coworkerInclude, mapCoworker } from "@/helpers/coworker";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { coworkerSchema } from "@/schemas/coworker.schema";

import { requireCoworkerManagementAccess } from "../coworker-management-access";
import { paramsSchema } from "./schema";

const route = createRoute({
  method: "delete",
  path: "/{id}",
  description: "Archive coworker and revoke active API keys",
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
    const { id } = c.req.valid("param");
    await requireCoworkerManagementAccess(c.var.authContext, id);

    const coworker = await prisma.$transaction(async (tx) => {
      const archivedAt = new Date();

      const archiveResult = await tx.coworker.updateMany({
        where: {
          id,
          archivedAt: null,
        },
        data: {
          archivedAt,
        },
      });

      if (archiveResult.count === 0) {
        throw notFound("Coworker not found");
      }

      await tx.coworkerApiKey.updateMany({
        where: {
          coworkerId: id,
          revokedAt: null,
        },
        data: {
          revokedAt: archivedAt,
        },
      });

      const archived = await tx.coworker.findFirst({
        where: { id },
        include: coworkerInclude,
      });

      if (!archived) {
        throw notFound("Coworker not found");
      }

      return archived;
    });

    return ok(c, mapCoworker(coworker));
  });
}
