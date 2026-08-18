import { createRoute } from "@hono/zod-openapi";
import { memberRepository } from "@sokosumi/database/repositories";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  resolveSiteIconAsOrganizationLogo,
  resolveSiteIconAsProjectLogo,
} from "@/lib/site-icon";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  siteIconQuerySchema,
  siteIconResponseSchema,
} from "@/schemas/site-icon.schema";

const route = createRoute({
  method: "get",
  path: "/site-icon",
  description:
    "Scrape a website's highest-quality icon, store it under exactly one organization or project logo prefix, and return the public URL. SSRF-guarded and authenticated.",
  tags: ["Tools"],
  request: {
    query: siteIconQuerySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      siteIconResponseSchema,
      "The stored icon URL, or null when none could be resolved",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { url, organizationId, projectId } = c.req.valid("query");

    const { userId } = requireUserAuthContext(c.var.authContext);
    if (projectId) {
      const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
      const project = await prisma.project.findFirst({
        where: { id: projectId, workspaceId: workspaceContext.workspaceId },
        select: { id: true },
      });
      if (!project) {
        throw notFound("Project not found");
      }
    } else {
      const member = await memberRepository.getMemberByUserIdAndOrganizationId(
        userId,
        organizationId!,
        prisma,
      );
      if (!member) {
        throw notFound("Organization not found");
      }
    }

    const iconUrl = projectId
      ? await resolveSiteIconAsProjectLogo(url, projectId)
      : await resolveSiteIconAsOrganizationLogo(url, organizationId!);

    return ok(c, siteIconResponseSchema.parse({ url: iconUrl }));
  });
}
