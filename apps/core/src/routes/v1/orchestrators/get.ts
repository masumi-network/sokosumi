import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { mapOrchestrator } from "@/helpers/orchestrator";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { orchestratorSchema } from "@/schemas/orchestrator.schema";

const querySchema = z.object({
  scope: z
    .enum(["all", "archived"])
    .optional()
    .default("all")
    .openapi({
      param: { name: "scope", in: "query" },
      description:
        "Orchestrator visibility scope. Defaults to 'all' active orchestrators. Use 'archived' for archived rows.",
      example: "all",
    }),
});

const route = createRoute({
  method: "get",
  path: "/",
  description: "List orchestrators (admin only)",
  tags: ["Orchestrators"],
  request: {
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      z.array(orchestratorSchema),
      "Retrieve orchestrators",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { scope } = c.req.valid("query");

    const orchestrators = await prisma.orchestrator.findMany({
      where:
        scope === "archived"
          ? { archivedAt: { not: null } }
          : { archivedAt: null },
      orderBy: { slug: "asc" },
    });

    return ok(c, orchestrators.map(mapOrchestrator));
  });
}
