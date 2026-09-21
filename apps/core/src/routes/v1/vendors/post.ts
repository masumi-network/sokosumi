import { createRoute } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { created } from "@/helpers/response";
import { mapVendor, vendorLogoCreateData } from "@/helpers/vendor";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  createVendorRequestSchema,
  vendorMembershipSchema,
} from "@/schemas/vendor.schema";

const route = createRoute({
  method: "post",
  path: "/",
  operationId: "createVendor",
  description:
    "Create a vendor owned by the authenticated developer. The caller becomes the first admin member. One-time cold-start setup for private Coworker registration; unrelated developers must not share a default vendor.",
  tags: ["Vendors"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createVendorRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      vendorMembershipSchema,
      "The created vendor with the caller's admin membership",
      {
        data: {
          id: "01960001-0001-7001-8001-000000000001",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          name: "Serviceplan",
          slug: "serviceplan",
          logos: {
            light: "https://example.com/logo-light.png",
            dark: "https://example.com/logo-dark.png",
          },
          role: "admin",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request - validation failed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict - vendor slug already exists"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const body = c.req.valid("json");
    const userAuth = requireUserAuthContext(c.var.authContext);

    try {
      const vendor = await prisma.$transaction(async (tx) => {
        const createdVendor = await tx.vendor.create({
          data: {
            name: body.name,
            slug: body.slug,
            ...vendorLogoCreateData(body.logos),
          },
        });
        await tx.vendorMember.create({
          data: {
            vendorId: createdVendor.id,
            userId: userAuth.userId,
            role: "admin",
          },
        });
        return createdVendor;
      });

      return created(
        c,
        vendorMembershipSchema.parse({
          ...mapVendor(vendor),
          role: "admin",
        }),
      );
    } catch (error) {
      if (isSlugUniqueConstraintError(error)) {
        throw conflict(
          "Vendor slug already exists. Please choose a different slug.",
        );
      }

      throw error;
    }
  });
}
