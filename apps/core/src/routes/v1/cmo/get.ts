import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoOverviewSchema } from "@/schemas/cmo.schema";

import { requireOverview } from "./helpers";

export const config = {
  method: "get" as const,
  tags: ["CMO"],
  responses: {
    200: jsonSuccessResponse(
      cmoOverviewSchema,
      "The Cuso the caller works with",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
  },
};

const route = createRoute({
  ...config,
  path: "/",
  operationId: "getCmoOverview",
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    return ok(c, await requireOverview({ userId }));
  });
}
