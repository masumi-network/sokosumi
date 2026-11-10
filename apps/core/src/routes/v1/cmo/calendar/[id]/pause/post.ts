import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoOverviewSchema,
  cmoProjectParamsSchema,
  cmoUpdateIdParamsSchema,
} from "@/schemas/cmo.schema";
import type { CusoTarget } from "@/services/cmo-cuso.service";
import { pauseCmoCalendarEntry } from "@/services/cmo-strategy.service";

import { requireOverview, rethrow } from "../../../helpers";

const config = {
  method: "post" as const,
  tags: ["CMO"],
  description:
    "Pauses one calendar entry's Social post: cancels it so it cannot go out. The approved plan stays as it is.",
  request: { params: cmoUpdateIdParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Entry paused"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse(
      "Not a planned Social post, or it can no longer be canceled",
    ),
  },
};

const route = createRoute({
  ...config,
  path: "/calendar/{id}/pause",
  operationId: "pauseCmoCalendarEntry",
});

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}/calendar/{id}/pause",
  operationId: "pauseCmoCalendarEntryForProject",
  request: {
    ...config.request,
    params: cmoProjectParamsSchema.extend(cmoUpdateIdParamsSchema.shape),
  },
});

async function pause(target: CusoTarget, entryId: string) {
  await pauseCmoCalendarEntry({ ...target, entryId }).catch(rethrow);
  return requireOverview(target);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    return ok(c, await pause({ userId }, id));
  });

  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, id } = c.req.valid("param");
    return ok(c, await pause({ userId, projectId }, id));
  });
}
