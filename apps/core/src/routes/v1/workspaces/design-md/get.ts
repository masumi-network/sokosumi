import { createRoute, z } from "@hono/zod-openapi";
import {
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";

import {
  readOrganizationDesignMd,
  readUserDesignMd,
} from "@/helpers/design-md";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { effectiveDesignMdSchema } from "@/schemas/design-md.schema";

const DESIGN_MD_ATTACHMENT_LABEL = "DESIGN.md";

const querySchema = z.object({
  organizationId: z
    .string()
    .optional()
    .openapi({
      param: { name: "organizationId", in: "query" },
      description:
        "The organization whose workspace is active. When the caller is a member, the organization's DESIGN.md is used; otherwise the personal (user) workspace DESIGN.md is returned.",
      example: "org_123",
    }),
});

const route = createRoute({
  method: "get",
  path: "/design-md",
  description:
    "Resolve the DESIGN.md in effect for the caller's current workspace. When `organizationId` is supplied and the caller is a member, the organization workspace's DESIGN.md is used; otherwise the personal workspace's DESIGN.md (or null) is returned.",
  tags: ["Workspaces"],
  request: {
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      effectiveDesignMdSchema,
      "The DESIGN.md in effect for the current workspace",
      {
        data: {
          designMd: {
            label: DESIGN_MD_ATTACHMENT_LABEL,
            url: "https://blob.example/design.md",
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
    const { userId } = requireUserContext(c.var.authContext);
    const { organizationId } = c.req.valid("query");

    if (organizationId) {
      const member = await memberRepository.getMemberByUserIdAndOrganizationId(
        userId,
        organizationId,
        prisma,
      );

      if (member) {
        const organization = await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { metadata: true },
        });
        const organizationDesignMd = readOrganizationDesignMd(
          organization?.metadata,
        );

        if (organizationDesignMd) {
          return ok(
            c,
            effectiveDesignMdSchema.parse({
              designMd: {
                label: DESIGN_MD_ATTACHMENT_LABEL,
                url: organizationDesignMd.url,
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
          ? { label: DESIGN_MD_ATTACHMENT_LABEL, url: userDesignMd.url }
          : null,
      }),
    );
  });
}
