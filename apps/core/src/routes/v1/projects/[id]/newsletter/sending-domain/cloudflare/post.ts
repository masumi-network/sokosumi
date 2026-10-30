import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { newsletterProjectParamsSchema } from "@/schemas/newsletter.schema";
import {
  connectNewsletterSendingDomainCloudflareRequestSchema,
  newsletterSendingDomainSchema,
} from "@/schemas/newsletter-sending-domain.schema";
import { connectNewsletterSendingDomainWithCloudflare } from "@/services/newsletter-sending-domain.service";

import { sendingDomainManageScope } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/newsletter/sending-domain/cloudflare",
    tags: ["Projects"],
    description:
      "Create the sending domain's DNS records in Cloudflare with an API token scoped to Zone · DNS · Edit for the domain's zone. Also adds the suggested `v=DMARC1; p=none;` record when the domain still has no DMARC policy. The token is used for this request only and is never stored or logged. Returns 422 when the token cannot edit the domain's zone. Any member with access to this Project may manage it; agents are rejected.",
    request: {
      params: newsletterProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: connectNewsletterSendingDomainCloudflareRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        newsletterSendingDomainSchema,
        "DNS records created in Cloudflare",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      502: jsonErrorResponse("Cloudflare request failed"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const scope = await sendingDomainManageScope(c, id);
    const domain = await connectNewsletterSendingDomainWithCloudflare(
      scope.projectId,
      c.req.valid("json").apiToken,
    );
    return ok(c, newsletterSendingDomainSchema.parse(domain));
  });
}
