import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  newsletterSendingDomainConnectQuerySchema,
  newsletterSendingDomainConnectSchema,
} from "@/schemas/newsletter-sending-domain.schema";
import { getNewsletterSendingDomainConnect } from "@/services/newsletter-sending-domain.service";

import { sendingDomainManageWorkspace } from "../context";

const route = createRoute({
  method: "get",
  path: "/sending-domain/domain-connect",
  tags: ["Newsletter"],
  description:
    "Discover the sending domain's DNS provider through Domain Connect (`_domainconnect` TXT) and return a signed one-click apply URL for the `sokosumi.com`/`newsletter` template. Applies a monitoring-only DMARC record too while the domain has no DMARC policy. Returns null when the provider does not support the template yet, nothing is left to add, or signing is not configured. Workspace owners and admins only; agents are rejected.",
  request: { query: newsletterSendingDomainConnectQuerySchema },
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
});

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const workspace = await sendingDomainManageWorkspace(c);
    const connect = await getNewsletterSendingDomainConnect(
      workspace.workspaceId,
      c.req.valid("query").projectId,
    );
    return ok(c, newsletterSendingDomainConnectSchema.parse(connect));
  });
}
