import { createRoute, z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  assignOrganizationMemberSeat,
  unassignOrganizationMemberSeat,
} from "@/helpers/organization-seat";
import { created, ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
  memberId: z.string().openapi({
    param: { name: "memberId", in: "path" },
    description: "Member ID",
    example: "member_123",
  }),
});

const assignResponseSchema = z.object({
  memberId: z.string(),
  seatAssignedAt: dateTimeSchema,
});

const unassignResponseSchema = z.object({
  memberId: z.string(),
});

const assignRoute = createRoute({
  method: "post",
  path: "/{id}/members/{memberId}/seat/assign",
  description:
    "Assign a paid seat to an organization member (owner/admin only).",
  tags: ["Organizations"],
  request: { params },
  responses: {
    201: jsonSuccessResponse(assignResponseSchema, "Seat assigned", {
      data: {
        memberId: "member_123",
        seatAssignedAt: "2025-01-01T00:00:00.000Z",
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

const unassignRoute = createRoute({
  method: "post",
  path: "/{id}/members/{memberId}/seat/unassign",
  description:
    "Unassign a paid seat from an organization member (owner/admin only).",
  tags: ["Organizations"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(unassignResponseSchema, "Seat unassigned", {
      data: {
        memberId: "member_123",
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(assignRoute, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id, memberId } = c.req.valid("param");

    const result = await assignOrganizationMemberSeat({
      actorUserId: userContext.userId,
      organizationId: id,
      memberId,
    });

    return created(c, assignResponseSchema.parse(result));
  });

  app.openapi(unassignRoute, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id, memberId } = c.req.valid("param");

    const result = await unassignOrganizationMemberSeat({
      actorUserId: userContext.userId,
      organizationId: id,
      memberId,
    });

    return ok(c, unassignResponseSchema.parse(result));
  });
}
