import { createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import { buildCoworkerUsableInWorkspaceWhere } from "@/helpers/access-control";
import { coworkerInclude, mapCoworker } from "@/helpers/coworker";
import { COWORKER_CAPABILITIES } from "@/helpers/coworker-capability";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "@/helpers/query-params";
import { ok } from "@/helpers/response";
import { buildAccessibleCoworkersWhere } from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
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
    .enum(["all", "whitelisted", "archived", "owned", "available"])
    .optional()
    .default("whitelisted")
    .openapi({
      param: { name: "scope", in: "query" },
      description:
        "Coworker visibility scope. Defaults to 'whitelisted'. Use 'all' for all active coworkers, 'archived' for archived coworkers, 'owned' for active coworkers accessible via vendor membership (vendor admin: all vendor coworkers; developer: assigned only; user-authenticated only), or 'available' for coworkers usable in the active workspace (global whitelist or GRANTED workspace access; user auth + workspace context required).",
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

    let baseScope: Prisma.CoworkerWhereInput;
    if (scope === "owned") {
      const userAuthContext = requireUserAuthContext(authContext);
      baseScope = {
        archivedAt: null,
        ...buildAccessibleCoworkersWhere(userAuthContext.userId),
      };
    } else if (scope === "available") {
      requireUserAuthContext(authContext);
      const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
      // Marketplace/hire pickers must not surface personal assistants as
      // coworkers (SOK-942). PA identity is orchestratorMembers on chat rooms.
      baseScope = {
        ...buildCoworkerUsableInWorkspaceWhere(workspaceContext.workspaceId),
        sokoBotId: null,
      };
    } else if (scope === "archived") {
      baseScope = { archivedAt: { not: null } };
    } else {
      // whitelisted / all: exclude shadow PA coworkers from hire galleries.
      baseScope = {
        archivedAt: null,
        sokoBotId: null,
        ...(scope === "whitelisted" ? { isWhitelisted: true } : {}),
      };
    }
    const where: Prisma.CoworkerWhereInput = {
      ...baseScope,
      ...(capability ? { capabilities: { hasEvery: capability } } : {}),
      // Marketplace / hire galleries never list shadow Soko Bot coworkers.
      // Owner-scoped PA picker uses room orchestratorMembers instead (SOK-942).
      ...(scope === "whitelisted" || scope === "all" || scope === "available"
        ? { sokoBotId: null }
        : {}),
    };

    const coworkers = await prisma.coworker.findMany({
      where,
      orderBy: [{ priority: "desc" }, { slug: "asc" }],
      include: coworkerInclude,
    });

    return ok(c, coworkers.map(mapCoworker));
  });
}
