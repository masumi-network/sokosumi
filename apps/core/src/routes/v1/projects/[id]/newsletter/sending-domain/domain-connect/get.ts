import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { newsletterProjectParamsSchema } from "@/schemas/newsletter.schema";
import { newsletterSendingDomainConnectSchema } from "@/schemas/newsletter-sending-domain.schema";
import { getNewsletterSendingDomainConnect } from "@/services/newsletter-sending-domain.service";

import { sendingDomainManageScope } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/newsletter/sending-domain/domain-connect",
    tags: ["Projects"],
    description:
      "Discover the sending domain's DNS provider through Domain Connect (`_domainconnect` TXT) and return a signed one-click apply URL for the `sokosumi.com`/`newsletter` template. Applies a monitoring-only DMARC record too while the domain has no DMARC policy. Returns null when the provider does not support the template yet, nothing is left to add, or signing is not configured. Any member with access to this Project may manage it; agents are rejected.",
    request: { params: newsletterProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        newsletterSendingDomainConnectSchema,
        "Domain Connect apply URL, or null",
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
    const connect = await getNewsletterSendingDomainConnect(scope.projectId);
    return ok(c, newsletterSendingDomainConnectSchema.parse(connect));
  });
}
