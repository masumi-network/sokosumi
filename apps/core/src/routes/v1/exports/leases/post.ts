import { createRoute } from "@hono/zod-openapi";

import { acquireExportLease } from "@/helpers/export-admission";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { exportLeaseSchema } from "@/schemas/export-lease.schema";

const route = createRoute({
  method: "post",
  path: "/leases",
  operationId: "acquireExportLease",
  tags: ["Exports"],
  description:
    "Reserve one export for the session user. Keep the lease token on the Web server and release it only after export cleanup finishes.",
  responses: {
    200: jsonSuccessResponse(exportLeaseSchema, "Export admitted"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Interactive session required"),
    429: jsonErrorResponse("Export limit exceeded"),
    503: jsonErrorResponse("Export admission unavailable"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    c.header("Cache-Control", "no-store");
    return ok(c, exportLeaseSchema.parse(await acquireExportLease(userId)));
  });
}
