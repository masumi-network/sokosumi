import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { newsletterProjectParamsSchema } from "@/schemas/newsletter.schema";
import { newsletterSendingDomainSchema } from "@/schemas/newsletter-sending-domain.schema";
import { checkNewsletterSendingDomain } from "@/services/newsletter-sending-domain.service";

import { sendingDomainManageScope } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/newsletter/sending-domain/check",
    tags: ["Projects"],
    description:
      "Ask Resend to verify the sending domain's DNS records now and return the updated status. Any member with access to this Project may manage it; agents are rejected.",
    request: { params: newsletterProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        newsletterSendingDomainSchema,
        "Newsletter sending domain checked",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const scope = await sendingDomainManageScope(c, id);
    const domain = await checkNewsletterSendingDomain(scope.projectId);
    return ok(c, newsletterSendingDomainSchema.parse(domain));
  });
}
