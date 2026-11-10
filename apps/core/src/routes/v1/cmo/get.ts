import { createRoute } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoOverviewSchema } from "@/schemas/cmo.schema";
import { findCusoForUser } from "@/services/cmo-cuso.service";

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
    // The default Cuso until CMO has a picker: preferred organization, else newest.
    const cuso = await findCusoForUser(userId);
    if (!cuso) throw notFound("Cuso is not hired yet");
    return ok(c, await requireOverview({ userId, projectId: cuso.projectId }));
  });
}
