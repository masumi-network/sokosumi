import { createRoute } from "@hono/zod-openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { config, readText } from "@/routes/v1/cmo/calendar/[id]/text/get";
import {
  cmoProjectParamsSchema,
  cmoUpdateIdParamsSchema,
} from "@/schemas/cmo.schema";

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}/calendar/{id}/text",
  operationId: "getCmoCalendarEntryTextForProject",
  request: {
    ...config.request,
    params: cmoProjectParamsSchema.extend(cmoUpdateIdParamsSchema.shape),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, id } = c.req.valid("param");
    return ok(c, await readText({ userId, projectId }, id));
  });
}
