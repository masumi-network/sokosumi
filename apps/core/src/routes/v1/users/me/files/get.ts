import { createRoute } from "@hono/zod-openapi";
import { BlobOrigin, BlobStatus } from "@sokosumi/database";
import { blobRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { filesSchema } from "@/schemas/file.schema";

const route = createRoute({
  method: "get",
  path: "/me/files",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(filesSchema, "Retrieve files by current user", {
      data: [
        {
          id: "blob_123",
          createdAt: "2025-01-15T10:30:00.000Z",
          updatedAt: "2025-01-15T10:30:00.000Z",
          userId: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
          jobId: "cmi4gmksz000104l8wps8p7fp",
          name: "document.pdf",
          origin: BlobOrigin.INPUT,
          status: BlobStatus.READY,
          size: 1024000,
          mimeType: "application/pdf",
          fileUrl: "https://storage.example.com/files/document.pdf",
          sourceUrl: null,
        },
        {
          id: "blob_456",
          createdAt: "2025-01-15T11:00:00.000Z",
          updatedAt: "2025-01-15T11:00:00.000Z",
          userId: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
          jobId: "cmi4gmksz000104l8wps8p8fp",
          name: "report.pdf",
          origin: BlobOrigin.OUTPUT,
          status: BlobStatus.READY,
          size: 2048000,
          mimeType: "application/pdf",
          fileUrl: null,
          sourceUrl: "https://external.example.com/reports/report.pdf",
        },
      ],
      meta: {
        timestamp: "2025-01-15T12:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;

    const files = await blobRepository.getBlobsByUserId(authContext.userId);

    return ok(c, filesSchema.parse(files));
  });
}
