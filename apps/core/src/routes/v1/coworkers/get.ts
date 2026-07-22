import { createRoute, z } from "@hono/zod-openapi";
import { coworkerInclude, mapCoworker } from "@/helpers/coworker";
import { COWORKER_CAPABILITIES } from "@/helpers/coworker-capability";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "@/helpers/query-params";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { coworkerSchema } from "@/schemas/coworker.schema";

const capabilityQuerySchema = z
  .preprocess(
    preprocessMultiValueQueryInput,
    z
      .array(z.enum(COWORKER_CAPABILITIES))
      .min(1)
      .optional()
      .transform(deduplicateQueryValues),
  )
  .openapi({
    param: { name: "capability", in: "query" },
    description:
      "Filter coworkers by capability. Supports repeated values and comma-separated lists. When multiple capabilities are provided, coworkers must support all of them.",
    example: "tasks,chat",
  });

const querySchema = z.object({
  scope: z
    .enum(["all", "whitelisted", "archived", "owned"])
    .optional()
    .default("whitelisted")
    .openapi({
      param: { name: "scope", in: "query" },
      description:
        "Coworker visibility scope. Defaults to 'whitelisted'. Use 'all' to include all active coworkers, 'archived' to include archived coworkers, or 'owned' to list active coworkers owned by the authenticated user (session only; admins see only their own).",
      example: "whitelisted",
    }),
  capability: capabilityQuerySchema,
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
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { scope, capability } = c.req.valid("query");
    const { authContext } = c.var;

    let baseScope: Record<string, unknown>;
    if (scope === "owned") {
      const userAuthContext = requireUserAuthContext(authContext);
      baseScope = {
        archivedAt: null,
        userId: userAuthContext.userId,
      };
    } else if (scope === "archived") {
      baseScope = { archivedAt: { not: null } };
    } else {
      baseScope = {
        archivedAt: null,
        ...(scope === "whitelisted" ? { isWhitelisted: true } : {}),
      };
    }
    const where = {
      ...baseScope,
      ...(capability ? { capabilities: { hasEvery: capability } } : {}),
    };

    const coworkers = await prisma.coworker.findMany({
      where,
      orderBy: [{ priority: "desc" }, { slug: "asc" }],
      include: coworkerInclude,
    });

    return ok(c, coworkers.map(mapCoworker));
  });
}
