import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoBrandBrainRequestSchema,
  cmoOverviewSchema,
} from "@/schemas/cmo.schema";
import { saveCmoBrandBrain } from "@/services/cmo.service";

import { requireOverview, rethrow } from "../helpers";

const route = createRoute({
  method: "put",
  path: "/brand-brain",
  operationId: "updateCmoBrandBrain",
  tags: ["CMO"],
  request: {
    body: {
      content: { "application/json": { schema: cmoBrandBrainRequestSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Brand Brain saved"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { brandBrain } = c.req.valid("json");
    await saveCmoBrandBrain({ userId }, { brandBrain }).catch(rethrow);
    return ok(c, await requireOverview(userId));
  });
}
