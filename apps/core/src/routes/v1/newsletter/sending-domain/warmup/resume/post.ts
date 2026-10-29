import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { newsletterSendingDomainSchema } from "@/schemas/newsletter-sending-domain.schema";
import { resumeNewsletterSendingDomainWarmup } from "@/services/newsletter-sending-domain.service";

import { sendingDomainManageWorkspace } from "../../context";

const route = createRoute({
  method: "post",
  path: "/sending-domain/warmup/resume",
  tags: ["Newsletter"],
  description:
    "Resume a verified custom sending domain after a warm-up pause. Clears the pause without restarting the daily ramp. Workspace owners and admins only; agents are rejected.",
  responses: {
    200: jsonSuccessResponse(
      newsletterSendingDomainSchema,
      "Sending domain warm-up resumed",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const workspace = await sendingDomainManageWorkspace(c);
    const domain = await resumeNewsletterSendingDomainWarmup(
      workspace.workspaceId,
    );
    return ok(c, newsletterSendingDomainSchema.parse(domain));
  });
}
