import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { organizationInviteLinkRepository } from "@sokosumi/database/repositories";
import { evaluateInviteLinkStatus } from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { resolveOrganizationInviteLinkResponseSchema } from "@/schemas/organization-invite-link.schema";

const params = z.object({
  token: z.string().openapi({
    param: { name: "token", in: "path" },
    description: "Invite link capability token from the /join URL",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{token}",
  description:
    "Resolve a shareable organization invite link for the /join preview. Public: the token is the capability, so the page renders while logged out. Organization details are returned only for a live (`valid`) link; invalid tokens yield just a status.",
  tags: ["Organization Invite Links"],
  security: [],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      resolveOrganizationInviteLinkResponseSchema,
      "The invite link status and (when valid) an org preview",
    ),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { token } = c.req.valid("param");
    const link = await organizationInviteLinkRepository.getInviteLinkByToken(
      token,
      prisma,
    );
    const status = evaluateInviteLinkStatus(link, new Date());

    if (status !== "valid" || !link) {
      return ok(
        c,
        resolveOrganizationInviteLinkResponseSchema.parse({
          status,
          organization: null,
        }),
      );
    }

    const organization = await prisma.organization.findUnique({
      where: { id: link.organizationId },
      select: { name: true, slug: true, logo: true },
    });

    return ok(
      c,
      resolveOrganizationInviteLinkResponseSchema.parse({
        status: organization ? "valid" : "not_found",
        organization: organization
          ? {
              name: organization.name,
              slug: organization.slug,
              logo: organization.logo,
            }
          : null,
      }),
    );
  });
}
