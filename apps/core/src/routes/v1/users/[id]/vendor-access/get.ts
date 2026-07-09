import { createRoute, z } from "@hono/zod-openapi";
import { VendorGrantStatus } from "@sokosumi/database";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "@/helpers/query-params";
import { ok } from "@/helpers/response";
import { mapVendorGrant, vendorGrantInclude } from "@/helpers/vendor";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import { type UserRouteVariables } from "@/routes/v1/users/user-route-context";
import { vendorGrantListSchema } from "@/schemas/vendor.schema";

import { requireSelfSessionVendorAccess } from "./auth";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const statusQuerySchema = z
  .preprocess(
    preprocessMultiValueQueryInput,
    z
      .array(z.enum(VendorGrantStatus))
      .min(1)
      .optional()
      .transform(deduplicateQueryValues),
  )
  .openapi({
    param: { name: "status", in: "query" },
    description: "Comma-separated vendor grant status filters",
    example: "PENDING,GRANTED",
  });

const route = createRoute({
  method: "get",
  path: "/",
  description:
    "List vendor access grants for the authenticated session user (path must be `me`).",
  tags: ["Users"],
  request: {
    params,
    query: z.object({
      status: statusQuerySchema,
    }),
  },
  responses: {
    200: jsonSuccessResponse(
      vendorGrantListSchema,
      "Retrieve the user's vendor access grants",
      {
        data: [],
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { status } = c.req.valid("query");
    const { resolvedUserId } = requireSelfSessionVendorAccess(
      c.var.authContext,
      c.var.userRouteContext,
    );

    const grants = await prisma.vendorGrant.findMany({
      where: {
        userId: resolvedUserId,
        ...(status ? { status: { in: status } } : {}),
      },
      include: vendorGrantInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    return ok(c, vendorGrantListSchema.parse(grants.map(mapVendorGrant)));
  });
}
