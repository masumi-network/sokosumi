import { createRoute } from "@hono/zod-openapi";

import { releaseExportLease } from "@/helpers/export-admission";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import {
  releaseExportLeaseBodySchema,
  releaseExportLeaseResponseSchema,
} from "@/schemas/export-lease.schema";

const route = createRoute({
  method: "delete",
  path: "/leases",
  operationId: "releaseExportLease",
  tags: ["Exports"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: releaseExportLeaseBodySchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      releaseExportLeaseResponseSchema,
      "Export lease released or no longer owned",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Interactive session required"),
    422: jsonErrorResponse("Invalid lease token"),
    503: jsonErrorResponse("Export admission unavailable"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { token } = c.req.valid("json");
    c.header("Cache-Control", "no-store");
    return ok(
      c,
      releaseExportLeaseResponseSchema.parse(
        await releaseExportLease(userId, token),
      ),
    );
  });
}
