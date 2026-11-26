import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { preprodAccessOf } from "@/helpers/preprod-access";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminOrganizationSlugParamSchema,
  adminPreprodAccessSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/{slug}/preprod-access",
  operationId: "getAdminOrganizationPreprodAccess",
  description:
    "Whether an Organization may use Preprod, with the 20 most recent changes (admin only).",
  tags: ["Admin"],
  request: {
    params: adminOrganizationSlugParamSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminPreprodAccessSchema,
      "Preprod access and its recent changes",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { slug } = c.req.valid("param");

    const target = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true, preprodEnabled: true },
    });
    if (!target) {
      throw notFound("Organization not found");
    }

    return ok(
      c,
      adminPreprodAccessSchema.parse(
        await preprodAccessOf(
          prisma,
          { type: "organization", id: target.id },
          target.preprodEnabled,
        ),
      ),
    );
  });
}
