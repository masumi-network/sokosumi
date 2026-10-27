import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  newsletterProjectParamsSchema,
  newsletterSchema,
} from "@/schemas/newsletter.schema";
import { getNewsletter } from "@/services/newsletter.service";

import { newsletterScope } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/newsletter",
    tags: ["Projects"],
    description:
      "Get the Project's newsletter settings. Returns 404 if no newsletter exists or the Project's workspace is outside the beta (utxo) organization.",
    request: { params: newsletterProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(newsletterSchema, "Newsletter settings"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const scope = await newsletterScope(c, id);
    return ok(c, newsletterSchema.parse(await getNewsletter(scope)));
  });
}
