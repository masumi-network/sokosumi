import { createRoute, z } from "@hono/zod-openapi";
import { BlobStatus } from "@sokosumi/database";

import { requireJobReadForRouteVars } from "@/helpers/access-control.js";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { filesSchema } from "@/schemas/file.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/files",
    description: "Get files associated with a job",
    tags: ["Jobs"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(filesSchema, "Retrieve files by job ID", {
        data: [
          {
            id: "blob_456",
            createdAt: "2025-01-15T10:35:00.000Z",
            updatedAt: "2025-01-15T10:35:00.000Z",
            jobId: "cmi4gmksz000104l8wps8p7fp",
            sourceUrl: "https://external.example.com/reports/result_report.pdf",
            name: "result_report.pdf",
            status: BlobStatus.READY,
            size: 2048000,
            mimeType: "application/pdf",
            fileUrl: "https://blob.vercel.app/result_report.pdf",
          },
        ],
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const blobs = await prisma.$transaction(async (tx) => {
      await requireJobReadForRouteVars(c.var, id, tx);
      const blobs = await tx.blob.findMany({
        where: {
          event: { jobId: id },
        },
        include: {
          event: {
            select: {
              jobId: true,
            },
          },
        },
      });
      return blobs.map((blob) => ({
        ...blob,
        jobId: blob.event.jobId,
        size: blob.size ? Number(blob.size) : null,
      }));
    });

    return ok(c, filesSchema.parse(blobs));
  });
}
