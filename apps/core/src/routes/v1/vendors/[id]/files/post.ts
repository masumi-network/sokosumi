import { createRoute, z } from "@hono/zod-openapi";
import {
  isOrganizationLogoAllowedContentType,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
} from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import { badRequest, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { requireVendorAdminOrPlatformAdmin } from "@/helpers/vendor-membership";
import { createVendorLogoUploadSession } from "@/lib/blob";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  createVendorLogoUploadRequestSchema,
  vendorLogoUploadSessionSchema,
} from "@/schemas/vendor-logo-upload.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Vendor ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/files",
  description: [
    "Mint a direct upload session for a vendor *logo* only.",
    "Pathname is under `vendors/{id}/logos/…`.",
    "Bytes go client → Vercel Blob (not through this API).",
    "Vendor admins or platform admins may mint.",
    "",
    "Agent / REST:",
    "1. POST this endpoint with `filename`, `contentType`, and `size`.",
    "2. PUT the raw file bytes to `data.uploadUrl` with header `Content-Type` from `data.headers`.",
    "3. Store the final public Blob URL on the vendor logo fields.",
    "",
    "Reference: https://vercel.com/docs/vercel-blob/vercel-signed-urls",
  ].join("\n"),
  tags: ["Vendors"],
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: createVendorLogoUploadRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      vendorLogoUploadSessionSchema,
      "Vendor logo upload session created successfully",
      {
        data: {
          uploadUrl:
            "https://store.public.blob.vercel-storage.com/vendors/vendor_123/logos/logo.png?vercel-blob-delegation=…",
          access: "public",
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          pathname: "vendors/vendor_123/logos/logo.png",
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
      "Forbidden - You must be a vendor admin or platform admin",
    ),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    503: jsonErrorResponse("Service Unavailable"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const uploadRequest = c.req.valid("json");

    await requireVendorAdminOrPlatformAdmin(c.var.authContext, id);

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

    const uploadSession = await createVendorLogoUploadSession(
      id,
      {
        filename: uploadRequest.filename,
        contentType,
        size: uploadRequest.size,
        maxSizeBytes,
      },
      token,
    );

    return created(c, vendorLogoUploadSessionSchema.parse(uploadSession));
  });
}
