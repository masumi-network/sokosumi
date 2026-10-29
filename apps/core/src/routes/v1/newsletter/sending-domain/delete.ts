import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { removeNewsletterSendingDomain } from "@/services/newsletter-sending-domain.service";

import { sendingDomainManageWorkspace } from "./context";

const route = createRoute({
  method: "delete",
  path: "/sending-domain",
  tags: ["Newsletter"],
  description:
    "Remove the workspace's newsletter sending domain from Resend and Sokosumi. A domain Resend no longer has is still removed here. Workspace owners and admins only; agents are rejected.",
  responses: {
    204: { description: "Newsletter sending domain removed" },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    502: jsonErrorResponse("Resend could not remove the domain"),
  },
});

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const workspace = await sendingDomainManageWorkspace(c);
    await removeNewsletterSendingDomain(workspace.workspaceId);
    return empty(c);
  });
}
