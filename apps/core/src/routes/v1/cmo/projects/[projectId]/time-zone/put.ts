import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoProjectParamsSchema,
  cmoTimeZoneSchema,
} from "@/schemas/cmo.schema";
import { setCmoTimeZone } from "@/services/cmo-hiring.service";

const body = z.object({ timeZone: cmoTimeZoneSchema }).openapi("CmoTimeZone");

const route = createRoute({
  method: "put",
  path: "/projects/{projectId}/time-zone",
  operationId: "setCmoTimeZoneForProject",
  tags: ["CMO"],
  description:
    "Sets the time zone the Project's Cuso works in: his routines move to the same local times in it, and his next runs are recomputed.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: body } },
    },
  },
  responses: {
    200: jsonSuccessResponse(body, "Cuso works in this time zone now"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    422: jsonErrorResponse("Not a time zone"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { timeZone } = c.req.valid("json");
    await setCmoTimeZone({ userId, projectId }, timeZone).catch(rethrow);
    return ok(c, { timeZone });
  });
}
