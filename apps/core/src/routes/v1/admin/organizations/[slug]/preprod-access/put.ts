import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  requirePreprodAccessOperator,
  setPreprodAccess,
} from "@/helpers/preprod-access";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminOrganizationSlugParamSchema,
  adminPreprodAccessSchema,
  setAdminPreprodAccessBodySchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "put",
  path: "/{slug}/preprod-access",
  operationId: "setAdminOrganizationPreprodAccess",
  description:
    "Switch Preprod access for an Organization on or off, with a reason. Records who switched it, for whom and why; a value it already has changes and records nothing. Requires an interactive admin session that is not impersonating.",
  tags: ["Admin"],
  request: {
    params: adminOrganizationSlugParamSchema,
    body: {
      // Without this, a request with no body skips validation and reaches
      // the handler without the mandatory reason.
      required: true,
      content: {
        "application/json": {
          schema: setAdminPreprodAccessBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminPreprodAccessSchema,
      "Preprod access and its recent changes",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity - validation failed"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const operator = requirePreprodAccessOperator(c.var.authContext);
    const { slug } = c.req.valid("param");
    const { enabled, reason } = c.req.valid("json");

    return ok(
      c,
      adminPreprodAccessSchema.parse(
        await setPreprodAccess({
          target: { type: "organization", where: { slug } },
          enabled,
          operatorId: operator.userId,
          reason,
        }),
      ),
    );
  });
}
