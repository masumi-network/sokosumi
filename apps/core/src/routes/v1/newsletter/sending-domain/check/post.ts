import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { newsletterSendingDomainSchema } from "@/schemas/newsletter-sending-domain.schema";
import { checkNewsletterSendingDomain } from "@/services/newsletter-sending-domain.service";

import { sendingDomainManageWorkspace } from "../context";

const route = createRoute({
  method: "post",
  path: "/sending-domain/check",
  tags: ["Newsletter"],
  description:
    "Ask Resend to verify the sending domain's DNS records now and return the updated status. Workspace owners and admins only; agents are rejected.",
  responses: {
    200: jsonSuccessResponse(
      newsletterSendingDomainSchema,
      "Newsletter sending domain checked",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const workspace = await sendingDomainManageWorkspace(c);
    const domain = await checkNewsletterSendingDomain(workspace.workspaceId);
    return ok(c, newsletterSendingDomainSchema.parse(domain));
  });
}
