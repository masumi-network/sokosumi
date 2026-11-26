import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoLandingPageLiveRequestSchema,
  cmoLandingPageLiveSchema,
  cmoSeoSuggestionParamsSchema,
} from "@/schemas/cmo-seo.schema";
import { markCmoLandingPageLive } from "@/services/cmo-seo-landing-page-live.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/seo/suggestions/{id}/live",
  operationId: "markCmoLandingPageLiveForProject",
  tags: ["CMO"],
  description:
    "Records that the owner published a landing page at an address on their own site. Search ads on its search that are not launched yet send people there from now on; a launched ad keeps its address.",
  request: {
    params: cmoSeoSuggestionParamsSchema,
    body: {
      content: {
        "application/json": { schema: cmoLandingPageLiveRequestSchema },
      },
      required: true,
    },
  },
  responses: {
    200: jsonSuccessResponse(
      cmoLandingPageLiveSchema,
      "The page, and the search ads that changed",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("No such landing page"),
    409: jsonErrorResponse("The address is not on the business's site"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, id } = c.req.valid("param");
    const { url } = c.req.valid("json");
    return ok(
      c,
      await markCmoLandingPageLive({ userId, projectId }, id, url).catch(
        rethrow,
      ),
    );
  });
}
