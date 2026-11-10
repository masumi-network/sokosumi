import { createRoute } from "@hono/zod-openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { config, pause } from "@/routes/v1/cmo/calendar/[id]/pause/post";
import {
  cmoProjectParamsSchema,
  cmoUpdateIdParamsSchema,
} from "@/schemas/cmo.schema";

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

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, id } = c.req.valid("param");
    return ok(c, await pause({ userId, projectId }, id));
  });
}
