import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  driveHead,
  promoteStagedUpload,
  stagedUploadPathname,
} from "@/lib/drive-blob";
import {
  nudgeFileExtraction,
  nudgeFileIndexing,
} from "@/lib/files/in-process-indexer";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import {
  activateDriveUploadResource,
  currentDriveUploadVersion,
} from "@/services/file-catalog.service";

const bodySchema = z.object({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
  pathname: z.string().min(1).max(1_000),
});

const responseSchema = z.object({
  resourceId: z.string(),
  /** Public Blob URL of the stored file; null inside a data room. */
  fileUrl: z.string().nullable(),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/finalize",
    description: [
      "Store an upload's bytes at its Drive pathname, and start indexing it.",
      "",
      "The grant writes to a staging key bound to the catalog version reserved",
      "at mint, so nothing server-side sees the bytes arrive. This moves that",
      "version's staged object onto the pathname (never replacing a file",
      "there), activates the catalog entry and queues extraction. Required:",
      "an upload is not in Drive until it is finalized. A pathname that no",
      "object backs finalizes nothing; 409 when another file holds it.",
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
      409: jsonErrorResponse("Conflict - another file holds the pathname"),
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

    const key = {
      workspaceId: context.workspaceId,
      scope: context.scope,
      ownerId: context.ownerId,
      pathname: body.pathname,
    };
    const versionId = await currentDriveUploadVersion(key);
    if (!versionId) throw notFound("No upload is pending at that path");

    // Only this version's grant could write its staged key. Nothing staged:
    // already promoted, or a grant minted before staging wrote the pathname.
    await promoteStagedUpload(
      stagedUploadPathname(versionId, body.pathname),
      body.pathname,
    );

    const metadata = await driveHead(body.pathname);
    if (!metadata) throw notFound("No uploaded file at that path");

    const activated = await activateDriveUploadResource({
      key,
      sizeBytes: metadata.size,
      mimeType: metadata.contentType ?? "application/octet-stream",
    });

    if (!activated) throw notFound("No upload is pending at that path");

    // Crons do not run on preview deployments, so the upload that created
    // the work also does it. An upload with its labels pinned empty (Make a
    // copy) asked for no labelling, so it pays for none: extraction only,
    // never a drain of other files' suggestion work.
    if (activated.labelsPinnedEmpty) nudgeFileExtraction();
    else nudgeFileIndexing();

    return ok(
      c,
      responseSchema.parse({
        resourceId: activated.resourceId,
        fileUrl: metadata.access === "public" ? metadata.url : null,
      }),
    );
  });
}
