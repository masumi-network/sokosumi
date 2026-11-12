import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoBrandFixRequestSchema,
  cmoBrandFixStartedSchema,
  cmoProjectParamsSchema,
} from "@/schemas/cmo.schema";
import { fixCmoBrandSection } from "@/services/cmo-strategy.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/brand/fix",
  operationId: "fixCmoBrandSectionForProject",
  tags: ["CMO"],
  description:
    "The owner says one Brand Brain section is wrong, or, with no section, what is true in their own words. Cuso rewrites only that section (or every section the note changes) in a short turn, and patches the plan it touches. While he is busy the fix waits.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      content: { "application/json": { schema: cmoBrandFixRequestSchema } },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      cmoBrandFixStartedSchema,
      "Cuso is fixing the section, or will once his current turn ends",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet, or no such section"),
    409: jsonErrorResponse("Out of credits"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { section, note } = c.req.valid("json");
    const started = await fixCmoBrandSection({
      userId,
      projectId,
      section,
      note,
    }).catch(rethrow);
    return created(
      c,
      cmoBrandFixStartedSchema.parse(
        "turnId" in started
          ? { turnId: started.turnId, queued: false }
          : { turnId: null, queued: true },
      ),
    );
  });
}
