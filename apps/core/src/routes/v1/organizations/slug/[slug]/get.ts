import { createRoute, z } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationBySlug } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { organizationRecordSchema } from "@/schemas/organization.schema";

const params = z.object({
  slug: z.string().openapi({
    param: { name: "slug", in: "path" },
    description: "Organization slug",
    example: "my-org",
  }),
});

const route = createRoute({
  method: "get",
  path: "/slug/{slug}",
  operationId: "getOrganizationBySlug",
  description:
    "Get the raw organization record by slug for the effective user when they are a member (session user, or orchestrator/coworker with authorized context headers (coworker requires workspace grant or baseline task binding))",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationRecordSchema,
      "Retrieve organization by slug",
      {
        data: {
          id: "org_123",
          name: "My Organization",
          slug: "my-org",
          logo: "https://example.com/logo.png",
          metadata: '{"url":"https://example.com"}',
          createdAt: "2025-01-01T00:00:00.000Z",
          stripeCustomerId: "cus_123",
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
    const userContext = await requireAuthorizedUserContext(c.var.authContext);
    const { slug } = c.req.valid("param");

    const organization = await prisma.$transaction(async (tx) => {
      const { organization } = await resolveMemberOrganizationBySlug({
        slug,
        userId: userContext.userId,
        tx,
      });

      return organization;
    });

    return ok(c, organizationRecordSchema.parse(organization));
  });
}
