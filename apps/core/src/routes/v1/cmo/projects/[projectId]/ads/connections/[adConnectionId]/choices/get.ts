import { createRoute, z } from "@hono/zod-openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  adsActions,
  choicesConfig,
} from "@/routes/v1/cmo/projects/[projectId]/ads/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";

const choicesProjectRoute = createRoute({
  ...choicesConfig,
  path: "/projects/{projectId}/ads/connections/{adConnectionId}/choices",
  operationId: "listCmoAdChoicesForProject",
  request: {
    ...choicesConfig.request,
    params: cmoProjectParamsSchema.extend({
      adConnectionId: z.string().uuid(),
    }),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(choicesProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, adConnectionId } = c.req.valid("param");
    return ok(
      c,
      await adsActions.choices({ userId, projectId }, adConnectionId),
    );
  });
}
