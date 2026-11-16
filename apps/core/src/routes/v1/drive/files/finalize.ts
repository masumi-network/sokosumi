import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { driveHead } from "@/lib/drive-blob";
import { nudgeFileIndexing } from "@/lib/files/in-process-indexer";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import { activateDriveUploadResource } from "@/services/file-catalog.service";

const bodySchema = z.object({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
  pathname: z.string().min(1).max(1_000),
});

const responseSchema = z.object({
  resourceId: z.string(),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/finalize",
    description: [
      "Confirm that an upload's bytes landed, and start indexing it.",
      "",
      "The bytes go client → Blob, so nothing server-side sees them arrive.",
      "This verifies the object exists, activates the catalog entry reserved",
      "when the grant was minted, and queues extraction. A pathname that no",
      "object backs finalizes nothing.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: bodySchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(responseSchema, "Upload finalized"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const body = c.req.valid("json");

    const context = await resolveFileRequestContext({
      authContext,
      scope: body.scope,
      organizationId: body.organizationId,
    });

    const metadata = await driveHead(body.pathname);
    if (!metadata) throw notFound("No uploaded file at that path");

    const activated = await activateDriveUploadResource({
      key: {
        workspaceId: context.workspaceId,
        scope: context.scope,
        ownerId: context.ownerId,
        pathname: body.pathname,
      },
      sizeBytes: metadata.size,
      mimeType: metadata.contentType ?? "application/octet-stream",
    });

    if (!activated) throw notFound("No upload is pending at that path");

    // Crons do not run on preview deployments, so the upload that created
    // the work also does it.
    nudgeFileIndexing();

    return ok(c, responseSchema.parse({ resourceId: activated.resourceId }));
  });
}
