import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { coworkerApiKeySchema } from "@/schemas/coworker-api-key.schema";

import { requireCoworkerAdminAuthContext } from "../../admin-guard";
import { paramsSchema } from "../schema";

const route = createRoute({
  method: "get",
  path: "/{id}/api-keys",
  description: "List coworker API keys (admin only)",
  tags: ["Coworkers"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      z.array(coworkerApiKeySchema),
      "Retrieve coworker API keys",
      {
        data: [
          {
            id: "cokey_123",
            coworkerId: "cow_123",
            name: "Production key",
            keyStart: "coworker_abcdefgh",
            expiresAt: "2026-12-31T23:59:59.000Z",
            revokedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
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
    await requireCoworkerAdminAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const coworker = await prisma.coworker.findFirst({
      where: {
        id,
        archivedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!coworker) {
      throw notFound("Coworker not found");
    }

    const keys = await prisma.coworkerApiKey.findMany({
      where: {
        coworkerId: id,
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
      orderBy: {
        createdAt: "desc",
      },
    });

    return ok(c, z.array(coworkerApiKeySchema).parse(keys));
  });
}
