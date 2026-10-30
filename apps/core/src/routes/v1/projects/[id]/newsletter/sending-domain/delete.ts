import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { newsletterProjectParamsSchema } from "@/schemas/newsletter.schema";
import { removeNewsletterSendingDomain } from "@/services/newsletter-sending-domain.service";

import { sendingDomainManageScope } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/newsletter/sending-domain",
    tags: ["Projects"],
    description:
      "Remove this Project's newsletter sending domain from Resend and Sokosumi. A domain Resend no longer has is still removed here. Any member with access to this Project may manage it; agents are rejected.",
    request: { params: newsletterProjectParamsSchema },
    responses: {
      204: { description: "Newsletter sending domain removed" },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      502: jsonErrorResponse("Resend could not remove the domain"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const scope = await sendingDomainManageScope(c, id);
    await removeNewsletterSendingDomain(scope.projectId);
    return empty(c);
  });
}
