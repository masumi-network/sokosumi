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
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  driveCopy,
  driveExists,
  driveHasAny,
  driveHead,
} from "@/lib/drive-blob";
import { nudgeFileExtraction } from "@/lib/files/in-process-indexer";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  copiedDriveFileSchema,
  copyDriveFileRequestSchema,
} from "@/schemas/drive-file.schema";
import {
  activateDriveUploadResource,
  driveCopyHolder,
  reserveDriveCopyResource,
} from "@/services/file-catalog.service";

/** Names tried ("x (copy)", "x (copy) 2" … 20) before the copy gives up with 409. */
const MAX_NAME_TRIES = 20;

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/copy",
    description: [
      "Make a copy of a Drive file in the same folder.",
      "The source stays. The copy is a new document with its own catalog id;",
      "tags, links and shares are not copied, and its category and tags are",
      "pinned empty so no paid model labels it. It is named",
      "`<name> (<label>).<ext>`, numbered when taken.",
      "Personal: owner only. Organization: any member.",
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
      200: jsonSuccessResponse(copiedDriveFileSchema, "Drive file copied"),
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
    const folderPrefix = pathname.slice(0, pathname.lastIndexOf("/") + 1);
    const folder = drivePathOf(folderPrefix).replace(/\/$/, "");

    await requireDriveFileAccess(authContext, scope, ownerId, {
      changes: [drivePathOf(pathname)],
      into: [folder],
    });

    const source = await driveHead(pathname);
    if (!source) throw notFound("Source file not found");

    const workspace = await resolveDriveTasksWorkspace({
      userContext,
      scope: scope === "user" ? "me" : "org",
      organizationId: scope === "organization" ? ownerId : undefined,
    });
    const key = (target: string) => ({
      workspaceId: workspace.workspaceId,
      scope,
      ownerId,
      pathname: target,
    });

    // The catalog owns the name before the bytes exist, so a backfill that
    // sees the object adopts this identity instead of minting another, and
    // a failure leaves an unfinished copy that the next try finishes rather
    // than bytes nobody owns.
    const sourceName = pathname.slice(folderPrefix.length);
    let target: string | null = null;
    for (let attempt = 1; attempt <= MAX_NAME_TRIES && !target; attempt++) {
      const candidate = `${folderPrefix}${copyName(sourceName, label, attempt)}`;
      const holder = await driveCopyHolder(key(candidate));
      if (holder === "unfinished-copy") {
        target = candidate;
      } else if (
        holder === "free" &&
        !(await driveExists(candidate)) &&
        !(await driveHasAny(`${candidate}/`))
      ) {
        try {
          await reserveDriveCopyResource({
            key: key(candidate),
            displayName: candidate.slice(folderPrefix.length),
            mimeType: source.contentType,
            sizeBytes: source.size,
            decidedByUserId: userContext.userId,
          });
          target = candidate;
        } catch (error) {
          // Another request reserved this name first.
          if (!isUniqueViolation(error)) throw error;
        }
      }
    }
    if (!target) throw conflict("No free name for the copy");
    const name = target.slice(folderPrefix.length);

    let copied: { url: string; access: "public" | "private" };
    const existing = await driveHead(target);
    if (existing) {
      // A previous try copied the bytes and stopped before activating.
      copied = existing;
    } else {
      try {
        const result = await driveCopy(source, target, {
          cacheControlMaxAge: parseCacheControlMaxAge(source.cacheControl),
        });
        copied = { url: result.url, access: result.store.access };
      } catch (error) {
        if (error instanceof BlobNotFoundError) {
          throw notFound("Source file not found");
        }
        // A concurrent try of the same unfinished copy wrote it first.
        const raced = await driveHead(target);
        if (!raced) throw error;
        copied = raced;
      }
    }

    const activated = await activateDriveUploadResource({
      key: key(target),
      sizeBytes: source.size,
      mimeType: source.contentType,
    });
    if (!activated) throw conflict("The copy was deleted; try again");

    // Extraction only, which is free. Labelling is paid, and the copy's
    // pinned category and tags leave every later suggestion run nothing to
    // ask (see reserveDriveCopyResource).
    nudgeFileExtraction();

    return ok(
      c,
      copiedDriveFileSchema.parse({
        name,
        fileUrl: copied.url,
        pathname: target,
        size: source.size,
        uploadedAt: new Date().toISOString(),
        dataRoom: copied.access === "private",
        resourceId: activated.resourceId,
      }),
    );
  });
}
