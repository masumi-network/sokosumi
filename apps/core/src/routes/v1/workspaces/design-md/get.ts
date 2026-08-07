import { createRoute } from "@hono/zod-openapi";
import {
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  readOrganizationDesignMd,
  readUserDesignMd,
} from "@/helpers/design-md";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { effectiveDesignMdSchema } from "@/schemas/design-md.schema";

const DESIGN_MD_ATTACHMENT_LABEL = "DESIGN.md";

const route = createRoute({
  method: "get",
  path: "/design-md",
  description:
    "Resolve the DESIGN.md in effect for the caller's current workspace. The active workspace is taken from the session (the active organization, or the personal workspace when none): when the caller is a member of the active organization, that organization's DESIGN.md is used; otherwise the personal workspace's DESIGN.md (or null) is returned.",
  tags: ["Workspaces"],
  responses: {
    200: jsonSuccessResponse(
      effectiveDesignMdSchema,
      "The DESIGN.md in effect for the current workspace",
      {
        data: {
          designMd: {
            label: DESIGN_MD_ATTACHMENT_LABEL,
            url: "https://blob.example/design.md",
            owner: {
              type: "organization",
              name: "Acme Inc",
              logo: "https://blob.example/logo.png",
            },
          },
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId, organizationId } = await requireAuthorizedUserContext(
      c.var.authContext,
    );

    if (organizationId) {
      const member = await memberRepository.getMemberByUserIdAndOrganizationId(
        userId,
        organizationId,
        prisma,
      );

      if (member) {
        const organization = await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { metadata: true, name: true, logo: true },
        });
        const organizationDesignMd = readOrganizationDesignMd(
          organization?.metadata,
        );

        if (organizationDesignMd && organization) {
          return ok(
            c,
            effectiveDesignMdSchema.parse({
              designMd: {
                label: DESIGN_MD_ATTACHMENT_LABEL,
                url: organizationDesignMd.url,
                owner: {
                  type: "organization",
                  name: organization.name,
                  logo: organization.logo,
                },
              },
            }),
          );
        }
      }
    }

    const user = await userRepository.getUserById(userId, prisma);
    const userDesignMd = readUserDesignMd(user?.metadata);

    return ok(
      c,
      effectiveDesignMdSchema.parse({
        designMd: userDesignMd
          ? {
              label: DESIGN_MD_ATTACHMENT_LABEL,
              url: userDesignMd.url,
              owner: { type: "user" },
            }
          : null,
      }),
    );
  });
}
