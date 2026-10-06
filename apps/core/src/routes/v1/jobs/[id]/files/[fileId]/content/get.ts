import { createRoute, z } from "@hono/zod-openapi";
import { requireJobReadForRouteVars } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  contentDispositionFor,
  contentSecurityPolicyFor,
  openStoredFileContentStream,
} from "@/services/file-content.service";

const route = createRoute({
  method: "get",
  path: "/{id}/files/{fileId}/content",
  tags: ["Jobs"],
  description:
    "Stream a ready job output, checking job access on every read without exposing a storage URL.",
  request: {
    params: z.object({ id: z.string().min(1), fileId: z.string().min(1) }),
    query: z.object({ download: z.enum(["true", "false"]).optional() }),
  },
  responses: {
    200: {
      description: "Output bytes",
      content: { "*/*": { schema: { type: "string", format: "binary" } } },
    },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    503: jsonErrorResponse("Storage unavailable"),
  },
});
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id, fileId } = c.req.valid("param");
    await requireJobReadForRouteVars(c.var, id, prisma);
    const blob = await prisma.blob.findFirst({
      where: {
        id: fileId,
        event: { jobId: id },
        status: "READY",
        fileUrl: { not: null },
      },
    });
    if (!blob?.fileUrl) throw notFound("Output unavailable");
    const result = await openStoredFileContentStream({
      objectKey: blob.fileUrl,
      displayName: blob.name ?? "Output",
      mimeType: blob.mimeType,
      sizeBytes: blob.size == null ? null : Number(blob.size),
      entityTag: `${blob.id}-${blob.updatedAt.getTime()}`,
      download: c.req.valid("query").download === "true",
    });
    return c.body(result.stream, 200, {
      "content-type": result.contentType,
      ...(result.size == null ? {} : { "content-length": String(result.size) }),
      "cache-control": "private, no-cache",
      etag: `"${result.entityTag}"`,
      "content-disposition": contentDispositionFor(
        result.displayName,
        result.inline,
      ),
      "x-content-type-options": "nosniff",
      "content-security-policy": contentSecurityPolicyFor(result.contentType),
    });
  });
}
