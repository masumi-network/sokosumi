import { createRoute, z } from "@hono/zod-openapi";

import { badRequest } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import {
  livePendingVendorInviteWhere,
  mapVendorMemberInvite,
} from "@/helpers/vendor-invite";
import { requireVendorAdminMembership } from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { vendorMemberInviteSchema } from "@/schemas/vendor.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Vendor ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const vendorInviteListSchema = z
  .array(vendorMemberInviteSchema)
  .openapi("VendorMemberInviteList");

const route = createRoute({
  method: "get",
  path: "/{id}/invites",
  operationId: "listVendorMemberInvites",
  description:
    "List a vendor's live pending member invitations with cursor pagination (vendor admin only).",
  tags: ["Vendors"],
  request: { params, query: cursorPaginationQuerySchema },
  responses: {
    200: jsonPaginatedSuccessResponse(
      vendorInviteListSchema,
      "Live pending vendor invitations",
      {
        data: [
          {
            id: "01960001-0001-7001-8001-000000000001",
            vendorId: "01960001-0001-7001-8001-000000000002",
            email: "dev@example.com",
            role: "developer",
            status: "PENDING",
            expiresAt: "2025-01-08T00:00:00.000Z",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
          pagination: {
            cursor: null,
            limit: 20,
            total: 1,
            nextCursor: null,
          },
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);

    const where = livePendingVendorInviteWhere(id);
    if (cursor !== undefined && !z.string().uuid().safeParse(cursor).success) {
      throw badRequest("Invalid pagination cursor");
    }
    const cursorInvite = cursor
      ? await prisma.vendorMemberInvite.findFirst({
          where: { AND: [where, { id: cursor }] },
          select: { id: true },
        })
      : undefined;

    if (cursor && !cursorInvite) {
      throw badRequest("Invalid pagination cursor");
    }

    const takePlusOne = take + 1;
    const [invites, count] = await prisma.$transaction([
      prisma.vendorMemberInvite.findMany({
        where,
        take: takePlusOne,
        skip: cursorInvite ? 1 : skip,
        cursor: cursorInvite ? { id: cursorInvite.id } : undefined,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      prisma.vendorMemberInvite.count({ where }),
    ]);

    const hasMore = invites.length === takePlusOne;
    const pagedInvites = invites.slice(0, take);
    const inviteItems = vendorInviteListSchema.parse(
      pagedInvites.map(mapVendorMemberInvite),
    );
    const paginationMeta = createPaginationMeta(
      inviteItems,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(c, inviteItems, paginationMeta);
  });
}
