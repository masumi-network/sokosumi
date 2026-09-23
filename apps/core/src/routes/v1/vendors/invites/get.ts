import { createRoute, z } from "@hono/zod-openapi";
import { normalizeInvitationEmail } from "@/helpers/chat-room-invitation";
import { badRequest, notFound } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import { mapVendor } from "@/helpers/vendor";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { myVendorInviteSchema } from "@/schemas/vendor.schema";

const myVendorInviteListSchema = z
  .array(myVendorInviteSchema)
  .openapi("MyVendorInviteList");

const route = createRoute({
  method: "get",
  path: "/invites",
  operationId: "listMyVendorInvites",
  description:
    "List live pending vendor member invitations matched to the authenticated user's verified account email with cursor pagination.",
  tags: ["Vendors"],
  request: { query: cursorPaginationQuerySchema },
  responses: {
    200: jsonPaginatedSuccessResponse(
      myVendorInviteListSchema,
      "Pending vendor invitations for the current user",
      {
        data: [
          {
            id: "01960001-0001-7001-8001-000000000001",
            role: "developer",
            status: "PENDING",
            expiresAt: "2025-01-08T00:00:00.000Z",
            createdAt: "2025-01-01T00:00:00.000Z",
            vendor: {
              id: "01960001-0001-7001-8001-000000000002",
              createdAt: "2025-01-01T00:00:00.000Z",
              updatedAt: "2025-01-01T00:00:00.000Z",
              name: "Serviceplan",
              slug: "serviceplan",
              logos: { light: null, dark: null },
            },
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
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const userAuth = requireUserAuthContext(c.var.authContext);

    const user = await prisma.user.findUnique({
      where: { id: userAuth.userId },
      select: { email: true, emailVerified: true },
    });
    if (!user) {
      throw notFound("User not found");
    }
    if (!user.emailVerified) {
      const emptyInvites = myVendorInviteListSchema.parse([]);
      return ok(
        c,
        emptyInvites,
        createPaginationMeta(emptyInvites, 0, take, false, cursor),
      );
    }
    const email = normalizeInvitationEmail(user.email);
    const now = new Date();
    const where = {
      email,
      status: "PENDING" as const,
      expiresAt: { gt: now },
    };

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
        include: { vendor: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      prisma.vendorMemberInvite.count({ where }),
    ]);

    const hasMore = invites.length === takePlusOne;
    const pagedInvites = invites.slice(0, take);
    const inviteItems = myVendorInviteListSchema.parse(
      pagedInvites.map((invite) => ({
        id: invite.id,
        role: invite.role,
        status: invite.status,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
        vendor: mapVendor(invite.vendor),
      })),
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
