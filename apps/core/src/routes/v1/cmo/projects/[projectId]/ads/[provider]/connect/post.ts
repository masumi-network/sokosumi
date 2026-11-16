import { createRoute, z } from "@hono/zod-openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  adsActions,
  connectConfig,
} from "@/routes/v1/cmo/projects/[projectId]/ads/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";

const connectProjectRoute = createRoute({
  ...connectConfig,
  path: "/projects/{projectId}/ads/{provider}/connect",
  operationId: "connectCmoAdsForProject",
  request: {
    ...connectConfig.request,
    params: cmoProjectParamsSchema.extend({
      provider: z.enum(["google_ads", "meta_ads"]),
    }),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(connectProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, provider } = c.req.valid("param");
    const { returnUrl } = c.req.valid("json");
    return ok(
      c,
      await adsActions.connect({ userId, projectId }, provider, returnUrl),
    );
  });
}
