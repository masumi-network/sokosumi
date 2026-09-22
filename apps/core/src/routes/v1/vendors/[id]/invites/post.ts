import { createRoute, z } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  assertVendorInviteRateLimits,
  expireStaleVendorInvites,
  livePendingVendorInviteWhere,
  mapVendorMemberInvite,
  normalizeVendorInviteEmail,
  vendorInviteExpiresAt,
} from "@/helpers/vendor-invite";
import { requireVendorAdminMembership } from "@/helpers/vendor-membership";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  createVendorMemberInviteRequestSchema,
  vendorMemberInviteSchema,
} from "@/schemas/vendor.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Vendor ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/invites",
  operationId: "createVendorMemberInvite",
  description:
    "Invite a user to join a vendor as a member by email (vendor admin only). Creates a pending invitation whether or not the email maps to a registered account, so the response cannot enumerate registered users. A membership is created only when the invitee accepts. Role is optional and defaults to developer.",
  tags: ["Vendors"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: createVendorMemberInviteRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      vendorMemberInviteSchema,
      "Pending vendor invitation",
      {
        data: {
          id: "01960001-0001-7001-8001-000000000001",
          vendorId: "01960001-0001-7001-8001-000000000002",
          email: "dev@example.com",
          role: "developer",
          status: "PENDING",
          expiresAt: "2025-01-08T00:00:00.000Z",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict"),
    429: jsonErrorResponse("Too Many Requests"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);

    const email = normalizeVendorInviteEmail(body.email);

    const invite = await serializableTransaction(async (tx) => {
      await expireStaleVendorInvites(tx, { vendorId: id });

      // If the email already belongs to a member of THIS vendor, refuse. The
      // admin can already see their own member list, so this leaks nothing new
      // about who has an account; it only avoids a dangling invite.
      const existingUser = await tx.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true },
      });
      if (existingUser) {
        const membership = await tx.vendorMember.findUnique({
          where: {
            vendorId_userId: { vendorId: id, userId: existingUser.id },
          },
          select: { id: true },
        });
        if (membership) {
          throw conflict("User is already a member of this vendor");
        }
      }

      // Idempotent: a live pending invite for this email is returned as-is,
      // so a repeat invite is not an error and does not count as enumeration.
      const existingInvite = await tx.vendorMemberInvite.findFirst({
        where: { ...livePendingVendorInviteWhere(id), email },
      });
      if (existingInvite) return existingInvite;

      await assertVendorInviteRateLimits(id, userAuth.userId, tx);

      return tx.vendorMemberInvite.create({
        data: {
          vendorId: id,
          email,
          role: body.role,
          expiresAt: vendorInviteExpiresAt(),
          invitedById: userAuth.userId,
        },
      });
    }, "Vendor invitation changed concurrently; retry the request");

    return created(c, mapVendorMemberInvite(invite));
  });
}
