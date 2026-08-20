import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";

import { evaluateOrganizationDeletion } from "@/helpers/deletion-evaluate";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { organizationDeletionEvaluationSchema } from "@/schemas/deletion.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/deletion",
  description:
    "Return current Organization-deletion blockers for an organization owner acting on that organization. Empty `blockers` means the existing wipe may proceed. Session owner only.",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationDeletionEvaluationSchema,
      "Current Organization-deletion blockers",
      {
        data: {
          blockers: ["ORGANIZATION_HAS_ADDITIONAL_MEMBERS"],
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden - Organization owner only"),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER],
    });

    const evaluation = await evaluateOrganizationDeletion(
      id,
      userContext.userId,
      prisma,
    );
    return ok(
      c,
      organizationDeletionEvaluationSchema.parse({
        blockers: evaluation.blockers,
      }),
    );
  });
}
