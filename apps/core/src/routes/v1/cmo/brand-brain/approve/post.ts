import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoOverviewSchema } from "@/schemas/cmo.schema";
import { confirmBrandBrain } from "@/services/brand-brain.service";

import { requireCmoProjectId, requireOverview } from "../../helpers";

const route = createRoute({
  method: "post",
  path: "/brand-brain/approve",
  operationId: "approveCmoBrandBrain",
  tags: ["CMO"],
  description:
    "A member confirmed the Project's Brand Brain, recorded with who and when. Cuso's yes/no questions come next, then the strategy.",
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Brand Brain approved"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("The Brand Brain is still being built"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    await confirmBrandBrain(await requireCmoProjectId(userId), userId);
    return ok(c, await requireOverview(userId));
  });
}
