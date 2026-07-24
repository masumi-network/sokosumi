import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapVendor, vendorLogoPatchData } from "@/helpers/vendor";
import { requireVendorAdminMembership } from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  patchVendorAdminRequestSchema,
  vendorSchema,
} from "@/schemas/vendor.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Vendor ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "patchVendor",
  description:
    "Update vendor profile fields (vendor admin only). Name and logos only; slug is immutable.",
  tags: ["Vendors"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: patchVendorAdminRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(vendorSchema, "The updated vendor"),
    400: jsonErrorResponse("Bad Request - validation failed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - vendor missing"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);

    const vendor = await prisma.vendor.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...vendorLogoPatchData(body.logos),
      },
    });

    return ok(c, mapVendor(vendor));
  });
}
