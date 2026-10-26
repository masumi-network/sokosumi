import { createRoute, z } from "@hono/zod-openapi";
import { SOCIAL_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { isNewsletterEnabled } from "@/lib/newsletter/feature";

const availabilitySchema = z
  .object({ enabled: z.boolean() })
  .openapi("NewsletterAvailability");

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/availability",
    tags: ["Newsletter"],
    description:
      "Read newsletter availability for the current workspace, including when newsletters are disabled.",
    responses: {
      200: jsonSuccessResponse(availabilitySchema, "Newsletter availability"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    await requireAuthorizedUserContext(c.var.authContext);
    let enabled = false;
    if (isNewsletterEnabled() && c.var.workspaceContext) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: c.var.workspaceContext.workspaceId },
        select: { organization: { select: { slug: true } } },
      });
      enabled = workspace?.organization?.slug === SOCIAL_BETA_ORGANIZATION_SLUG;
    }
    return ok(c, availabilitySchema.parse({ enabled }));
  });
}
