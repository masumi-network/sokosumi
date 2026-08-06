import { createRoute, z } from "@hono/zod-openapi";
import { memberRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { membersSchema } from "@/schemas/member.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/members",
  description:
    "List members of an organization for the current member, including a session-derived last-seen timestamp per member.",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      membersSchema,
      "List organization members with last-seen timestamps",
      {
        data: [
          {
            id: "member_123",
            organizationId: "org_123",
            role: "member",
            seatAssignedAt: null,
            createdAt: "2025-01-01T00:00:00.000Z",
            user: {
              id: "user_123",
              name: "Jane Doe",
              email: "jane@example.com",
              image: null,
            },
            lastSeenAt: "2025-06-08T14:30:00.000Z",
          },
        ],
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
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");

    // Avoid interactive transaction on this read-only path — pool contention
    // under parallel room-page loads caused P2028 (SOKOSUMI-Q7). Membership
    // gate + last-seen lookup do not need a shared snapshot.
    await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
    });

    const members = await memberRepository.getMembersWithUserAndLastSeen(
      id,
      prisma,
    );

    return ok(c, membersSchema.parse(members));
  });
}
