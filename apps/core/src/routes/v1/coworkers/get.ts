import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { coworkerSchema } from "@/schemas/coworker.schema";

const querySchema = z.object({
  scope: z
    .enum(["all", "whitelisted", "archived"])
    .optional()
    .default("whitelisted")
    .openapi({
      param: { name: "scope", in: "query" },
      description:
        "Coworker visibility scope. Defaults to 'whitelisted'. Use 'all' to include all active coworkers or 'archived' to include archived coworkers.",
      example: "whitelisted",
    }),
});

const route = createRoute({
  method: "get",
  path: "/",
  description: "List available coworkers",
  tags: ["Coworkers"],
  request: {
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(z.array(coworkerSchema), "Retrieve coworkers", {
      data: [],
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireUserAuthContext(c.var.authContext);
    const { scope } = c.req.valid("query");

    const where =
      scope === "archived"
        ? { archivedAt: { not: null } }
        : {
            archivedAt: null,
            ...(scope === "whitelisted" ? { isWhitelisted: true } : {}),
          };

    const coworkers = await prisma.coworker.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return ok(c, z.array(coworkerSchema).parse(coworkers));
  });
}
