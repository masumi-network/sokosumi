import { createRoute, z } from "@hono/zod-openapi";
import { BlobOrigin, BlobStatus } from "@sokosumi/database";
import { blobRepository } from "@sokosumi/database/repositories";

import { unauthorized } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { filesSchema } from "@/schemas/file.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/files",
  tags: ["Jobs"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(filesSchema, "Retrieve files by job ID", {
      data: [
        {
          id: "blob_123",
          createdAt: "2025-01-15T10:30:00.000Z",
          updatedAt: "2025-01-15T10:30:00.000Z",
          userId: "user_123",
          jobId: "cmi4gmksz000104l8wps8p7fp",
          name: "input_document.pdf",
          origin: BlobOrigin.INPUT,
          status: BlobStatus.READY,
          size: 1024000,
          mimeType: "application/pdf",
          fileUrl: "https://storage.example.com/files/input_document.pdf",
          sourceUrl: null,
        },
        {
          id: "blob_456",
          createdAt: "2025-01-15T10:35:00.000Z",
          updatedAt: "2025-01-15T10:35:00.000Z",
          userId: "user_123",
          jobId: "cmi4gmksz000104l8wps8p7fp",
          name: "result_report.pdf",
          origin: BlobOrigin.OUTPUT,
          status: BlobStatus.READY,
          size: 2048000,
          mimeType: "application/pdf",
          fileUrl: null,
          sourceUrl: "https://external.example.com/reports/result_report.pdf",
        },
      ],
      meta: {
        timestamp: "2025-01-15T12:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { user } = c.var;
    const { id } = c.req.valid("param");

    if (!user) {
      throw unauthorized("A non-user cannot access files");
    }

    const files = await blobRepository.getBlobsByUserIdAndJobId(user.id, id);

    return ok(c, filesSchema.parse(files));
  });
}
