import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { newsletterProjectParamsSchema } from "@/schemas/newsletter.schema";
import {
  newsletterSendingDomainSchema,
  putNewsletterSendingDomainRequestSchema,
} from "@/schemas/newsletter-sending-domain.schema";
import { putNewsletterSendingDomain } from "@/services/newsletter-sending-domain.service";

import { sendingDomainManageScope } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/newsletter/sending-domain",
    tags: ["Projects"],
    description:
      "Set this Project's newsletter From address. A new domain is registered with Resend and returns the DNS records to publish; the same domain with another local part only changes the address. Any member with access to this Project may manage it; agents are rejected.",
    request: {
      params: newsletterProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: putNewsletterSendingDomainRequestSchema,
          },
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
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const scope = await sendingDomainManageScope(c, id);
    const domain = await putNewsletterSendingDomain(
      scope.projectId,
      c.req.valid("json").fromAddress,
    );
    return ok(c, newsletterSendingDomainSchema.parse(domain));
  });
}
