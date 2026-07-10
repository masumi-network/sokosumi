import { createRoute } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import { mapVendor, vendorLogoCreateData } from "@/helpers/vendor";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  createVendorRequestSchema,
  vendorSchema,
} from "@/schemas/vendor.schema";

const route = createRoute({
  method: "post",
  path: "/",
  operationId: "createAdminVendor",
  description: "Create a vendor (admin only).",
  tags: ["Admin"],
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
    200: jsonSuccessResponse(vendorSchema, "The created vendor", {
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
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    400: jsonErrorResponse("Bad Request - validation failed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict - vendor slug already exists"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const body = c.req.valid("json");

    try {
      const vendor = await prisma.vendor.create({
        data: {
          name: body.name,
          slug: body.slug,
          ...vendorLogoCreateData(body.logos),
        },
      });

      return ok(c, mapVendor(vendor));
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
