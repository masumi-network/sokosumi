import { createRoute } from "@hono/zod-openapi";

import { getEnv } from "@/config/env";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { isUserAuthContext } from "@/middleware/auth";
import { newsletterProjectParamsSchema } from "@/schemas/newsletter.schema";
import { newsletterSendingDomainStateSchema } from "@/schemas/newsletter-sending-domain.schema";
import { getNewsletterSendingDomain } from "@/services/newsletter-sending-domain.service";

import { sendingDomainReadScope } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/newsletter/sending-domain",
    tags: ["Projects"],
    description:
      "Read this Project's newsletter sending domain, its DNS records and verification status. This Project's newsletter sends from it once verified. When the domain has no DMARC policy, the records include a suggested monitoring-only `_dmarc` TXT. A pending domain is re-read from Resend at most once a minute.",
    request: { params: newsletterProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        newsletterSendingDomainStateSchema,
        "Newsletter sending domain",
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
    const scope = await sendingDomainReadScope(c, id);
    const sendingDomain = await getNewsletterSendingDomain(scope.projectId);
    return ok(
      c,
      newsletterSendingDomainStateSchema.parse({
        sendingDomain,
        canManage: isUserAuthContext(c.var.authContext),
        fallbackAvailable: !!getEnv().NEWSLETTER_FROM_DOMAIN,
      }),
    );
  });
}
