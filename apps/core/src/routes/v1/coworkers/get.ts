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
import { vendorSchema } from "@/schemas/vendor.schema";

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

/** A workspace presented as the "vendor" of the Soko Bots that live in it. */
async function workspaceAsVendor(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      organization: { select: { name: true, logo: true } },
      user: { select: { name: true } },
    },
  });
  if (!workspace) return null;
  const name =
    workspace.organization?.name ??
    (workspace.user?.name ? `${workspace.user.name} (personal)` : "Workspace");
  return vendorSchema.parse({
    id: `workspace:${workspace.id}`,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    name,
    slug: `workspace-${workspace.id}`,
    logos: {
      light: workspace.organization?.logo ?? null,
      dark: workspace.organization?.logo ?? null,
    },
  });
}

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
      // Soko Bots of every member are usable by everyone in the workspace.
      baseScope = buildCoworkerUsableInWorkspaceWhere(
        workspaceContext.workspaceId,
      );
    } else if (scope === "archived") {
      baseScope = { archivedAt: { not: null } };
    } else {
      baseScope = {
        archivedAt: null,
        ...(scope === "whitelisted" ? { isWhitelisted: true } : {}),
      };
    }
    const where: Prisma.CoworkerWhereInput = {
      ...baseScope,
      ...(capability ? { capabilities: { hasEvery: capability } } : {}),
    };

    const coworkers = await prisma.coworker.findMany({
      where,
      orderBy: [{ priority: "desc" }, { slug: "asc" }],
      include: coworkerInclude,
    });

    const mapped = coworkers.map(mapCoworker);
    // Soko Bots belong to the workspace, not to a marketplace vendor: group
    // them under the workspace's own name and logo in pickers.
    const botRows = coworkers.filter((coworker) => coworker.sokoBotId);
    if (botRows.length > 0 && scope === "available") {
      const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
      const workspaceVendor = await workspaceAsVendor(
        workspaceContext.workspaceId,
      );
      if (workspaceVendor) {
        for (const coworker of mapped) {
          if (botRows.some((row) => row.id === coworker.id)) {
            coworker.vendor = workspaceVendor;
          }
        }
      }
    }
    return ok(c, mapped);
  });
}
