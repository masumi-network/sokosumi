import { createRoute } from "@hono/zod-openapi";

import { getEnv } from "@/config/env";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { newsletterSendingDomainStateSchema } from "@/schemas/newsletter-sending-domain.schema";
import {
  canManageNewsletterSendingDomain,
  getNewsletterSendingDomain,
} from "@/services/newsletter-sending-domain.service";

import { sendingDomainReadWorkspace } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/sending-domain",
    tags: ["Newsletter"],
    description:
      "Read the current workspace's newsletter sending domain, its DNS records and verification status. Every Project newsletter in the workspace sends from it once verified. When the domain has no DMARC policy, the records include a suggested monitoring-only `_dmarc` TXT. A pending domain is re-read from Resend at most once a minute.",
    responses: {
      200: jsonSuccessResponse(
        newsletterSendingDomainStateSchema,
        "Newsletter sending domain",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const workspace = await sendingDomainReadWorkspace(c);
    const auth = c.var.authContext;
    const [sendingDomain, canManage] = await Promise.all([
      getNewsletterSendingDomain(workspace.workspaceId),
      auth.actor === "user"
        ? canManageNewsletterSendingDomain(auth.userId, workspace)
        : false,
    ]);
    return ok(
      c,
      newsletterSendingDomainStateSchema.parse({
        sendingDomain,
        canManage,
        fallbackAvailable: !!getEnv().NEWSLETTER_FROM_DOMAIN,
      }),
    );
  });
}
