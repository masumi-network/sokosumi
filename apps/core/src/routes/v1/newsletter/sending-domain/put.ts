import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  newsletterSendingDomainSchema,
  putNewsletterSendingDomainRequestSchema,
} from "@/schemas/newsletter-sending-domain.schema";
import { putNewsletterSendingDomain } from "@/services/newsletter-sending-domain.service";

import { sendingDomainManageWorkspace } from "./context";

const route = createRoute({
  method: "put",
  path: "/sending-domain",
  tags: ["Newsletter"],
  description:
    "Set the workspace's newsletter From address. A new domain is registered with Resend and returns the DNS records to publish; the same domain with another local part only changes the address. Workspace owners and admins only; agents are rejected.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: putNewsletterSendingDomainRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      newsletterSendingDomainSchema,
      "Newsletter sending domain saved",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const workspace = await sendingDomainManageWorkspace(c);
    const domain = await putNewsletterSendingDomain(
      workspace.workspaceId,
      c.req.valid("json").fromAddress,
    );
    return ok(c, newsletterSendingDomainSchema.parse(domain));
  });
}
