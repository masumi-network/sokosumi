import { createRoute } from "@hono/zod-openapi";
import prisma from "@/lib/db/prisma";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { getCredits } from "@/helpers/user";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { organizationsSchema } from "@/schemas/organization.schema";

const route = createRoute({
  method: "get",
  path: "/organizations",
  description: "Get all organizations for the current user",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(
      organizationsSchema,
      "Retrieve organizations for current user",
      {
        data: [
          {
            id: "org_123",
            name: "My Organization",
            slug: "my-org",
            createdAt: "2025-01-01T00:00:00.000Z",
            role: "member",
            credits: 100.0,
          },
        ],
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;

    const organizations = await prisma.$transaction(async (tx) => {
      const members = await tx.member.findMany({
        where: { userId: authContext.userId },
        include: { organization: true },
      });

      return await Promise.all(
        members.map(async (member) => {
          const credits = await getCredits(
            authContext.userId,
            member.organization.id,
            tx,
          );
          return {
            ...member.organization,
            role: member.role,
            credits,
          };
        }),
      );
    });
    return ok(c, organizationsSchema.parse(organizations));
  });
}
