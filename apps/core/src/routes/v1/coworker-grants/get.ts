import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { coworkerGrantListSchema } from "@/schemas/coworker-grant.schema";

const route = createRoute({
  method: "get",
  path: "/",
  description:
    "List the authenticated user's coworker access grants (pending requests and resolutions)",
  tags: ["Coworker Grants"],
  responses: {
    200: jsonSuccessResponse(coworkerGrantListSchema, "List coworker grants"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Session-only on purpose: a delegated coworker must never be able to
    // inspect (or, on the resolve route, approve) its own access requests.
    const { userId } = requireUserAuthContext(c.var.authContext);

    const grants = await prisma.coworkerGrant.findMany({
      where: { userId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        coworker: {
          select: { id: true, slug: true, name: true, image: true },
        },
      },
    });

    return ok(
      c,
      coworkerGrantListSchema.parse(
        grants.map((grant) => ({
          id: grant.id,
          scope: grant.scope,
          status: grant.status,
          createdAt: grant.createdAt,
          resolvedAt: grant.resolvedAt,
          coworker: grant.coworker,
        })),
      ),
    );
  });
}
