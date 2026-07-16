import { createRoute } from "@hono/zod-openapi";

import { coworkerInclude, mapCoworker } from "@/helpers/coworker";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { coworkerSchema } from "@/schemas/coworker.schema";
import { patchCoworkerWhitelistRequestSchema } from "../../schema";
import { paramsSchema } from "../schema";

const route = createRoute({
  method: "patch",
  path: "/{id}/whitelist",
  description: "Update coworker whitelist status (admin only)",
  tags: ["Coworkers"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: patchCoworkerWhitelistRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      coworkerSchema,
      "Update coworker whitelist status",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { isWhitelisted } = c.req.valid("json");

    const coworker = await prisma.$transaction(async (tx) => {
      const updatedCount = await tx.coworker.updateMany({
        where: {
          id,
          archivedAt: null,
        },
        data: {
          isWhitelisted,
        },
      });

      if (updatedCount.count === 0) {
        throw notFound("Coworker not found");
      }

      const updatedCoworker = await tx.coworker.findFirst({
        where: {
          id,
          archivedAt: null,
        },
        include: coworkerInclude,
      });

      if (!updatedCoworker) {
        throw notFound("Coworker not found");
      }

      return updatedCoworker;
    });

    return ok(c, mapCoworker(coworker));
  });
}
