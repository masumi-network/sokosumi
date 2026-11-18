import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import {
  cmoCompetitorCreateSchema,
  cmoCompetitorsSchema,
} from "@/schemas/cmo-competitors.schema";
import { addTrackedCompetitor } from "@/services/cmo-competitors.service";

import { competitorsResponse } from "./helpers.js";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/competitors",
  operationId: "addCmoCompetitorForProject",
  tags: ["CMO"],
  description:
    "A member adds a competitor to track, up to the limit. The next weekly check reads it; later Brand Brain research never changes it.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: cmoCompetitorCreateSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoCompetitorsSchema, "Competitor added"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("Already tracked, or the limit is reached"),
    422: jsonErrorResponse("Not a web address or an account"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const target = { userId, projectId: c.req.valid("param").projectId };
    await addTrackedCompetitor(target, c.req.valid("json")).catch(rethrow);
    return ok(c, await competitorsResponse(target));
  });
}
