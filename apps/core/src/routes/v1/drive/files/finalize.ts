import { createRoute, z } from "@hono/zod-openapi";
import { FileSourceScope } from "@sokosumi/database";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { publishStagedUpload } from "@/helpers/drive-staged-upload";
import { notFound } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { driveHead, driveOwnerOf } from "@/lib/drive-blob";
import {
  nudgeFileExtraction,
  nudgeFileIndexing,
} from "@/lib/files/in-process-indexer";
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
  /**
   * The staged upload attempt, from the upload session. Given: publishes
   * exactly that attempt. Omitted: the released flow, bytes PUT to pathname.
   */
  attemptId: z.string().uuid().optional(),
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
      "Confirm that an upload's bytes landed, and start indexing it.",
      "",
      "Released flow (no `attemptId`): the bytes were PUT to `pathname` and are",
      "already in Drive; this activates the catalog entry and queues",
      "extraction. A pathname that no object backs finalizes nothing.",
      "",
      "Staged flow (`attemptId` from a session minted with `staged: true`):",
      "moves that attempt's staged object onto `pathname`, never replacing a",
      "file there, and activates it; the file is in Drive only after this.",
      "409 when a newer upload replaced the attempt or another file holds the",
      "pathname. Repeating a finished finalize is harmless.",
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

    // The pathname must be in the store just authorized, and outside any
    // data room this caller is not in, before any storage is read or moved:
    // room access can change between mint and finalize.
    const owner = driveOwnerOf(body.pathname);
    if (
      !owner ||
      owner.ownerId !== context.ownerId ||
      owner.sourceScope !==
        (context.scope === "user"
          ? FileSourceScope.USER
          : FileSourceScope.ORGANIZATION)
    ) {
      throw notFound("No upload is pending at that path");
    }
    await requireDriveFileAccess(authContext, context.scope, context.ownerId, {
      into: [owner.path.split("/").slice(0, -1).join("/")],
    });

    const key = {
      workspaceId: context.workspaceId,
      scope: context.scope,
      ownerId: context.ownerId,
      pathname: body.pathname,
    };

    let activated: { resourceId: string; labelsPinnedEmpty: boolean } | null;
    if (body.attemptId) {
      activated = await publishStagedUpload(key, body.attemptId);
    } else {
      const metadata = await driveHead(body.pathname);
      if (!metadata) throw notFound("No uploaded file at that path");
      activated = await activateDriveUploadResource({
        key,
        sizeBytes: metadata.size,
        mimeType: metadata.contentType ?? "application/octet-stream",
      });
    }

    if (!activated) throw notFound("No upload is pending at that path");

    // Crons do not run on preview deployments, so the upload that created
    // the work also does it. An upload with its labels pinned empty (Make a
    // copy) asked for no labelling, so it pays for none: extraction only,
    // never a drain of other files' suggestion work.
    if (activated.labelsPinnedEmpty) nudgeFileExtraction();
    else nudgeFileIndexing();

    const stored = await driveHead(body.pathname);
    return ok(
      c,
      responseSchema.parse({
        resourceId: activated.resourceId,
        fileUrl: stored?.access === "public" ? stored.url : null,
      }),
    );
  });
}
