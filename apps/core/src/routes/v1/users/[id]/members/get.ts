import { createRoute, z } from "@hono/zod-openapi";
import { memberRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { membersWithOrganizationSchema } from "@/schemas/member.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/members",
  description:
    "List the user's organization memberships including the embedded organization: path `me` for the session user, or a user id when the caller may access that user's data.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      membersWithOrganizationSchema,
      "Retrieve the user's memberships with organizations",
      {
        data: [
          {
            id: "member_123",
            userId: "user_123",
            organizationId: "org_123",
            role: "member",
            seatAssignedAt: null,
            createdAt: "2025-01-01T00:00:00.000Z",
            organization: {
              id: "org_123",
              name: "My Organization",
              slug: "my-org",
              logo: "https://example.com/logo.png",
              metadata: '{"url":"https://example.com"}',
              createdAt: "2025-01-01T00:00:00.000Z",
              stripeCustomerId: "cus_123",
            },
          },
        ],
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
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const members = await memberRepository.getMembersWithOrganizationByUserId(
      resolvedUserId,
      prisma,
    );

    return ok(c, membersWithOrganizationSchema.parse(members));
  });
}
