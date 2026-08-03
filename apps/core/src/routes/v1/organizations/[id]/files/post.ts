import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import {
  isOrganizationLogoAllowedContentType,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
} from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import { badRequest, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { created } from "@/helpers/response";
import { createOrganizationLogoUploadSession } from "@/lib/blob";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import {
  createOrganizationLogoUploadRequestSchema,
  organizationLogoUploadSessionSchema,
} from "@/schemas/organization-logo-upload.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/files",
  description: [
    "Mint a direct upload session for an organization *logo* only.",
    "Pathname is under `organizations/{id}/logos/…`.",
    "Bytes go client → Vercel Blob (not through this API).",
    "Only organization owners and admins may mint.",
    "",
    "Agent / REST:",
    "1. POST this endpoint with `filename`, `contentType`, and `size`.",
    "2. PUT the raw file bytes to `data.uploadUrl` with header `Content-Type` from `data.headers`.",
    "3. Store the final public Blob URL on `organization.logo`.",
    "",
    "Reference: https://vercel.com/docs/vercel-blob/vercel-signed-urls",
  ].join("\n"),
  tags: ["Organizations"],
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: createOrganizationLogoUploadRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      organizationLogoUploadSessionSchema,
      "Organization logo upload session created successfully",
      {
        data: {
          uploadUrl:
            "https://store.public.blob.vercel-storage.com/organizations/org_123/logos/logo.png?vercel-blob-delegation=…",
          access: "public",
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          pathname: "organizations/org_123/logos/logo.png",
          addRandomSuffix: true,
          maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
          expiresAt: "2026-02-16T12:15:00.000Z",
        },
        meta: {
          timestamp: "2026-02-16T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You must be an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    503: jsonErrorResponse("Service Unavailable"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const uploadRequest = c.req.valid("json");

    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    const token = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    // Schema already enforces logo MIME/size; keep a runtime guard for clarity.
    if (!isOrganizationLogoAllowedContentType(uploadRequest.contentType)) {
      throw badRequest(
        `Unsupported content type: "${uploadRequest.contentType}"`,
      );
    }

    const maxSizeBytes =
      uploadRequest.maxSizeBytes ?? ORGANIZATION_LOGO_MAX_SIZE_BYTES;
    const contentType = uploadRequest.contentType.trim().toLowerCase();

    const uploadSession = await createOrganizationLogoUploadSession(
      organization.id,
      {
        filename: uploadRequest.filename,
        contentType,
        size: uploadRequest.size,
        maxSizeBytes,
      },
      token,
    );

    return created(c, organizationLogoUploadSessionSchema.parse(uploadSession));
  });
}
