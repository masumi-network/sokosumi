import { createRoute } from "@hono/zod-openapi";
import {
  DRIVE_FILE_MAX_NAME_LENGTH,
  isDriveFolderMarker,
} from "@sokosumi/utils";
import { BlobNotFoundError } from "@vercel/blob";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  drivePathOf,
  requireDriveFileAccess,
} from "@/helpers/drive-file-access";
import { parseCacheControlMaxAge } from "@/helpers/drive-file-move";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import {
  conflict,
  forbidden,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  driveCopy,
  driveExists,
  driveHasAny,
  driveHead,
  driveUncopy,
  isInDataRoom,
} from "@/lib/drive-blob";
import { nudgeFileExtraction } from "@/lib/files/in-process-indexer";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  copyDriveFileRequestSchema,
  driveFileSchema,
} from "@/schemas/drive-file.schema";
import {
  publishDriveCopyResource,
  releaseDriveCopyResource,
  reserveDriveCopyResource,
} from "@/services/file-catalog.service";

/** Names tried ("x (copy)", "x (copy) 2" … 20) before the copy gives up with 409. */
const MAX_NAME_TRIES = 20;

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/copy",
    description: [
      "Make a copy of one of your own Drive files in the same folder.",
      "The source stays. The copy is a new document with its own catalog id;",
      "tags, links and shares are not copied, and its category and tags are",
      "pinned empty so no paid model labels it. It is named",
      "`<name> (<label>).<ext>`, numbered when taken.",
      "Personal files only, by their owner. Organization and data-room",
      "files are refused with 403.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: copyDriveFileRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(driveFileSchema, "Drive file copied"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict - no free name for the copy"),
      422: jsonErrorResponse("Unprocessable Entity"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

/**
 * `weekly.md`, "copy", try 2 → `weekly (copy) 2.md`. A long stem is trimmed,
 * never the label, number or extension, so every try is a different name
 * within the length limit. Trims whole code points, so an emoji is kept or
 * dropped, never split into half a surrogate pair.
 */
export function copyName(source: string, label: string, attempt: number) {
  const tail = ` (${label})${attempt === 1 ? "" : ` ${attempt}`}`;
  const dot = source.lastIndexOf(".");
  const hasExtension =
    dot > 0 && source.length - dot + tail.length < DRIVE_FILE_MAX_NAME_LENGTH;
  const stem = hasExtension ? source.slice(0, dot) : source;
  const extension = hasExtension ? source.slice(dot) : "";
  let room = DRIVE_FILE_MAX_NAME_LENGTH - tail.length - extension.length;
  let kept = "";
  for (const character of stem) {
    room -= character.length;
    if (room < 0) break;
    kept += character;
  }
  return `${kept}${tail}${extension}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
    const { pathname, label } = c.req.valid("json");

    if (isDriveFolderMarker(pathname)) {
      throw unprocessableEntity("A folder marker cannot be copied");
    }
    const { scope, ownerId } = parseDriveFilePathname(
      pathname,
      userContext.userId,
    );
    if (scope !== "user" || ownerId !== userContext.userId) {
      throw forbidden("Only your own files can be copied");
    }
    const folderPrefix = pathname.slice(0, pathname.lastIndexOf("/") + 1);
    const folder = drivePathOf(folderPrefix).replace(/\/$/, "");

    await requireDriveFileAccess(authContext, scope, ownerId, {
      changes: [drivePathOf(pathname)],
      into: [folder],
    });

    const source = await driveHead(pathname);
    if (!source) throw notFound("Source file not found");
    if (source.access !== "public" || (await isInDataRoom(pathname))) {
      throw forbidden("Files in a data room cannot be copied");
    }

    const workspace = await resolveDriveTasksWorkspace({
      userContext,
      scope: "me",
    });
    const key = (target: string) => ({
      workspaceId: workspace.workspaceId,
      scope,
      ownerId,
      pathname: target,
    });

    // Identity and the free-indexing pins first, then bytes, then one fenced
    // publish (see reserveDriveCopyResource). An outcome this request cannot
    // know leaves the claim for reconcileStaleDriveCopies to settle.
    const sourceName = pathname.slice(folderPrefix.length);
    let target: string | null = null;
    let resourceId = "";
    for (let attempt = 1; attempt <= MAX_NAME_TRIES && !target; attempt++) {
      const candidate = `${folderPrefix}${copyName(sourceName, label, attempt)}`;
      if (
        (await driveExists(candidate)) ||
        (await driveHasAny(`${candidate}/`))
      ) {
        continue;
      }
      try {
        resourceId = await reserveDriveCopyResource({
          key: key(candidate),
          displayName: candidate.slice(folderPrefix.length),
          mimeType: source.contentType,
          sizeBytes: source.size,
          decidedByUserId: userContext.userId,
        });
        target = candidate;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    if (!target) throw conflict("No free name for the copy");
    const name = target.slice(folderPrefix.length);
    const claim = { resourceId, pathname: target };

    let copied: { url: string; etag: string };
    try {
      copied = await driveCopy(pathname, target, {
        contentType: source.contentType,
        cacheControlMaxAge: parseCacheControlMaxAge(source.cacheControl),
      });
    } catch (error) {
      // The store answered "no source": nothing was written.
      if (error instanceof BlobNotFoundError) {
        await releaseDriveCopyResource(claim);
        throw notFound("Source file not found");
      }
      throw error;
    }

    // The target must still be this write, and the source unchanged since
    // its head, so the bytes are the ones its type describes. If not, undo
    // only this write, matched by the ETag its copy returned.
    const [written, sourceNow] = await Promise.all([
      driveHead(target),
      driveHead(pathname),
    ]);
    if (written?.etag !== copied.etag || sourceNow?.etag !== source.etag) {
      try {
        await driveUncopy(target, copied.etag);
        await releaseDriveCopyResource(claim);
      } catch {
        // Left to the reconciler.
      }
      throw conflict("The file changed while it was copied; try again");
    }

    const published = await publishDriveCopyResource({
      ...claim,
      sizeBytes: written.size,
      mimeType: written.contentType,
    });
    if (!published) {
      throw conflict("The copy was moved or deleted before it was finished");
    }

    // Extraction only, which is free. Labelling is paid, and the copy's
    // pinned category and tags leave every later suggestion run nothing to
    // ask (see reserveDriveCopyResource).
    nudgeFileExtraction();

    return ok(
      c,
      driveFileSchema.parse({
        name,
        fileUrl: copied.url,
        pathname: target,
        size: written.size,
        uploadedAt: written.uploadedAt.toISOString(),
        dataRoom: false,
      }),
    );
  });
}
