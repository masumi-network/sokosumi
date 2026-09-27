import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { memberRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { organizationSeatUnassignmentSchema } from "@/schemas/organization-seat.schema";
import {
  mapSeatRepositoryError,
  SEAT_RELEASE_CONFLICT_MESSAGE,
} from "@/services/organization-seat.service";

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

const route = createRoute({
  method: "delete",
  path: "/{id}/members/{memberId}/seat",
  description:
    "Unassign an organization member's seat. Only organization owners and admins may do this.",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationSeatUnassignmentSchema,
      "The unassigned seat",
      {
        data: {
          memberId: "member_123",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You must be an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found - Organization or member not found"),
    409: jsonErrorResponse("Conflict"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id, memberId } = c.req.valid("param");

    try {
      // Serializable to match the assignment routes (SOK-1007). Releasing a
      // seat cannot exceed capacity, but SSI only sees an anomaly when both
      // sides run at this level: a Read Committed release racing a
      // serializable assignment lets the assignment answer 200 with a seat the
      // release has already cleared.
      const result = await serializableTransaction(async (tx) => {
        const { organization } = await resolveMemberOrganizationById({
          id,
          userId: userContext.userId,
          tx,
          allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
        });

        const member = await memberRepository.unassignSeat(
          memberId,
          organization.id,
          tx,
        );

        return {
          memberId: member.id,
        };
      }, SEAT_RELEASE_CONFLICT_MESSAGE);

      return ok(c, organizationSeatUnassignmentSchema.parse(result));
    } catch (error) {
      mapSeatRepositoryError(error);
    }
  });
}
