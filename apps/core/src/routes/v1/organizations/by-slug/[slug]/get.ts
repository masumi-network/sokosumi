import { createRoute, z } from "@hono/zod-openapi";
import { parseOrganizationMetadata } from "@sokosumi/utils";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationBySlug } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { organizationWithRoleSchema } from "@/schemas/organization.schema";

const params = z.object({
  slug: z.string().openapi({
    param: { name: "slug", in: "path" },
    description: "Organization slug",
    example: "my-org",
  }),
});

const route = createRoute({
  method: "get",
  path: "/by-slug/{slug}",
  description: "Get organization details by slug for the current member",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationWithRoleSchema,
      "Retrieve organization by slug",
      {
        data: {
          id: "org_123",
          name: "My Organization",
          slug: "my-org",
          logo: "https://example.com/logo.png",
          metadata: {
            url: "https://example.com",
            invoiceEmail: "test@example.com",
          },
          createdAt: "2025-01-01T00:00:00.000Z",
          role: "member",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You are not a member of this organization",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { slug } = c.req.valid("param");

    const organization = await prisma.$transaction(async (tx) => {
      const { organization, role } = await resolveMemberOrganizationBySlug({
        slug,
        userId: userContext.userId,
        tx,
      });

      return {
        ...organization,
        metadata: parseOrganizationMetadata(organization.metadata),
        role,
      };
    });

    return ok(c, organizationWithRoleSchema.parse(organization));
  });
}
