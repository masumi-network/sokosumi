import { createRoute, z } from "@hono/zod-openapi";
import { VendorGrantStatus } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

import { forbidden, notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  canDenyGrant,
  mapVendorGrant,
  vendorGrantInclude,
} from "@/helpers/vendor";
import { publishTaskEventData } from "@/lib/ably/publish";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import { type UserRouteVariables } from "@/routes/v1/users/user-route-context";
import { vendorGrantSchema } from "@/schemas/vendor.schema";

import { requireSelfSessionVendorAccess } from "../../auth";

const params = z.object({
  id: usersRoutePathUserIdSchema,
  grantId: z.string().openapi({
    param: { name: "grantId", in: "path" },
    description: "Vendor grant ID",
    example: "01960001-0001-7001-8001-000000000099",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{grantId}/deny",
  description:
    "Deny a pending vendor access grant for the authenticated session user (path must be `me`).",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(vendorGrantSchema, "Vendor access grant denied", {
      data: {
        id: "01960001-0001-7001-8001-000000000099",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        scope: "VENDOR",
        status: "DENIED",
        vendorId: "01960001-0001-7001-8001-000000000001",
        vendor: {
          id: "01960001-0001-7001-8001-000000000001",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          name: "Service Plan",
          slug: "service-plan",
          logo: null,
        },
        userId: "user_123",
        workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        workspace: {
          id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          name: "Personal",
          slug: null,
          userId: "user_123",
          userName: "Alex",
          organizationId: null,
          organizationName: null,
          organizationSlug: null,
        },
        resolvedAt: "2025-01-01T00:00:00.000Z",
        parkedTaskCount: 0,
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { grantId } = c.req.valid("param");
    const { session } = requireSelfSessionVendorAccess(
      c.var.authContext,
      c.var.userRouteContext,
    );

    const { grant, affectedTaskIds } = await serializableTransaction(
      async (tx) => {
        const existingGrant = await tx.vendorGrant.findUnique({
          where: { id: grantId },
        });

        if (!existingGrant) {
          throw notFound("Vendor grant not found");
        }

        if (existingGrant.userId !== session.userId) {
          throw forbidden("You can only manage your own vendor access grants");
        }

        if (!canDenyGrant(existingGrant.status)) {
          throw unprocessableEntity(
            `Cannot deny vendor access grant with status ${existingGrant.status}`,
          );
        }

        const now = new Date();
        const affectedTasks = await tx.task.findMany({
          where: { pendingVendorGrantId: grantId },
          select: { id: true },
        });

        await tx.vendorGrant.update({
          where: { id: grantId },
          data: {
            status: VendorGrantStatus.DENIED,
            resolvedAt: now,
          },
        });

        if (affectedTasks.length > 0) {
          await tx.task.updateMany({
            where: { pendingVendorGrantId: grantId },
            data: {
              status: TaskStatus.CANCELED,
              pendingVendorGrantId: null,
            },
          });
        }

        const updatedGrant = await tx.vendorGrant.findUniqueOrThrow({
          where: { id: grantId },
          include: vendorGrantInclude,
        });

        return {
          grant: updatedGrant,
          affectedTaskIds: affectedTasks.map((task) => task.id),
        };
      },
      "Could not deny vendor access grant",
    );

    await Promise.all(
      affectedTaskIds.map((taskId) =>
        publishTaskEventData({
          userId: session.userId,
          taskId,
          eventType: "task_event",
        }),
      ),
    );

    return ok(c, vendorGrantSchema.parse(mapVendorGrant(grant)));
  });
}
