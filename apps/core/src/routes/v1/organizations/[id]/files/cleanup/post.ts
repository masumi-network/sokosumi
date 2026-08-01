import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import { deleteOrganizationLogoIfOwned } from "@/lib/blob";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { organizationLogoCleanupRequestSchema } from "@/schemas/organization-logo-upload.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const cleanupResultSchema = z
  .object({
    ok: z.literal(true),
  })
  .openapi("OrganizationLogoCleanupResult");

const route = createRoute({
  method: "post",
  path: "/{id}/files/cleanup",
  description: [
    "Best-effort delete of a prior organization logo blob when the URL is",
    "owned by this organization (`organizations/{id}/logos/…`).",
    "Foreign, legacy, or invalid URLs are ignored. Owners and admins only.",
  ].join(" "),
  tags: ["Organizations"],
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: organizationLogoCleanupRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      cleanupResultSchema,
      "Cleanup attempted (owned logos deleted; others ignored)",
      {
        data: { ok: true },
        meta: {
          timestamp: "2026-02-16T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You must be an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { url } = c.req.valid("json");

    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    await deleteOrganizationLogoIfOwned(url, organization.id);

    return ok(c, cleanupResultSchema.parse({ ok: true }));
  });
}
