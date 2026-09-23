import { createRoute } from "@hono/zod-openapi";

import { LIMITS } from "@/config/constants";
import { conflict, forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  isCreatedByUserUniqueConstraintError,
  isSlugUniqueConstraintError,
} from "@/helpers/prisma";
import { created, ok } from "@/helpers/response";
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
    200: jsonSuccessResponse(
      vendorMembershipSchema,
      "The vendor you already administer, returned when you re-create the same slug",
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

    // Server-side match to the CLI registration gate: a self-service vendor
    // requires an organization workspace (an org membership).
    const organizationCount = await prisma.member.count({
      where: { userId: userAuth.userId },
    });
    if (organizationCount === 0) {
      throw forbidden(
        "Creating a vendor requires an organization workspace. Create or join an organization first.",
      );
    }

    // Idempotent owner retry: if the slug is taken by a vendor the caller
    // already administers, return it instead of 409. Checked before the cap so
    // a repeat create does not trip the per-user limit.
    const slugOwner = await prisma.vendor.findUnique({
      where: { slug: body.slug },
      include: {
        vendorMembers: {
          where: { userId: userAuth.userId, role: "admin" },
          select: { id: true },
        },
      },
    });
    if (slugOwner) {
      if (slugOwner.vendorMembers.length > 0) {
        return ok(
          c,
          vendorMembershipSchema.parse({
            ...mapVendor(slugOwner),
            role: "admin",
          }),
        );
      }
      throw conflict(
        "Vendor slug already exists. Please choose a different slug.",
      );
    }

    // Cap self-service vendors per user (one-time cold-start, not a namespace).
    const selfServiceCount = await prisma.vendor.count({
      where: { createdByUserId: userAuth.userId },
    });
    if (selfServiceCount >= LIMITS.SELF_SERVICE_VENDOR_LIMIT_PER_USER) {
      throw conflict(
        `You can create at most ${LIMITS.SELF_SERVICE_VENDOR_LIMIT_PER_USER} vendor. Use the vendor you already administer, or ask a platform admin to create another.`,
      );
    }

    try {
      const vendor = await prisma.$transaction(async (tx) => {
        const createdVendor = await tx.vendor.create({
          data: {
            name: body.name,
            slug: body.slug,
            createdByUserId: userAuth.userId,
            // Self-service vendors stay off the global grant picker until a
            // platform admin lists them.
            listed: false,
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
        const racedSlugOwner = await prisma.vendor.findUnique({
          where: { slug: body.slug },
          include: {
            vendorMembers: {
              where: { userId: userAuth.userId, role: "admin" },
              select: { id: true },
            },
          },
        });
        if (racedSlugOwner?.vendorMembers.length) {
          return ok(
            c,
            vendorMembershipSchema.parse({
              ...mapVendor(racedSlugOwner),
              role: "admin",
            }),
          );
        }
        throw conflict(
          "Vendor slug already exists. Please choose a different slug.",
        );
      }
      if (isCreatedByUserUniqueConstraintError(error)) {
        throw conflict(
          `You can create at most ${LIMITS.SELF_SERVICE_VENDOR_LIMIT_PER_USER} vendor. Use the vendor you already administer, or ask a platform admin to create another.`,
        );
      }

      throw error;
    }
  });
}
