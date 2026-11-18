import { createRoute } from "@hono/zod-openapi";
import { FileSourceKind, FileSourceScope } from "@sokosumi/database";
import {
  DRIVE_FILE_MAX_NAME_LENGTH,
  isDriveFolderMarker,
} from "@sokosumi/utils";
import { BlobNotFoundError, del } from "@vercel/blob";

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
import prisma from "@/lib/db/prisma";
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
import { adoptDriveUploadResource } from "@/services/file-catalog.service";

/** Names tried ("x (copy)", "x (copy) 2" … 20) before the copy gives up with 409. */
const MAX_NAME_TRIES = 20;

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/copy",
    description: [
      "Make a copy of a Drive file in the same folder.",
      "The source stays. The copy is a new document with its own catalog id;",
      "tags, links and shares are not copied. It is named",
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
 * within the length limit.
 */
export function copyName(source: string, label: string, attempt: number) {
  const tail = ` (${label})${attempt === 1 ? "" : ` ${attempt}`}`;
  const dot = source.lastIndexOf(".");
  const hasExtension =
    dot > 0 && source.length - dot + tail.length < DRIVE_FILE_MAX_NAME_LENGTH;
  const stem = hasExtension ? source.slice(0, dot) : source;
  const extension = hasExtension ? source.slice(dot) : "";
  const room = DRIVE_FILE_MAX_NAME_LENGTH - tail.length - extension.length;
  return `${stem.slice(0, room)}${tail}${extension}`;
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
    const catalogKey = (target: string) => ({
      workspaceId_sourceKind_sourceScope_sourceId: {
        workspaceId: workspace.workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope:
          scope === "user"
            ? FileSourceScope.USER
            : FileSourceScope.ORGANIZATION,
        sourceId: target,
      },
    });

    // A name is free when no object, folder or catalog entry holds it: a
    // catalog entry left at a path would hand the copy someone else's
    // identity and tags.
    const sourceName = pathname.slice(folderPrefix.length);
    let name: string | null = null;
    for (let attempt = 1; attempt <= MAX_NAME_TRIES && !name; attempt++) {
      const candidate = copyName(sourceName, label, attempt);
      const target = `${folderPrefix}${candidate}`;
      const taken =
        (await driveExists(target)) ||
        (await driveHasAny(`${target}/`)) ||
        (await prisma.fileResource.findUnique({
          where: catalogKey(target),
          select: { id: true },
        }));
      if (!taken) name = candidate;
    }
    if (!name) throw conflict("No free name for the copy");

    let copied: Awaited<ReturnType<typeof driveCopy>>;
    try {
      copied = await driveCopy(source, `${folderPrefix}${name}`, {
        cacheControlMaxAge: parseCacheControlMaxAge(source.cacheControl),
      });
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        throw notFound("Source file not found");
      }
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes("already exists")
      ) {
        throw conflict("Target pathname already exists");
      }
      throw error;
    }

    // A new document, not a second name for an old one: its own id, so tags,
    // project links and deletion never reach the source. Identity and its
    // extraction job land together or not at all; without them the bytes go
    // too, so a retry finds the same name free.
    let resourceId: string;
    try {
      resourceId = await prisma.$transaction(async (tx) => {
        if (
          await tx.fileResource.findUnique({
            where: catalogKey(copied.pathname),
            select: { id: true },
          })
        ) {
          throw Object.assign(new Error("Catalog entry exists"), {
            code: "P2002",
          });
        }
        return adoptDriveUploadResource({
          key: {
            workspaceId: workspace.workspaceId,
            scope,
            ownerId,
            pathname: copied.pathname,
          },
          displayName: name,
          mimeType: source.contentType ?? null,
          sizeBytes: source.size,
          uploadedAt: new Date(),
          client: tx,
        });
      });
    } catch (error) {
      await del(copied.pathname, { token: copied.store.token }).catch(
        () => undefined,
      );
      if (isUniqueViolation(error)) {
        throw conflict("Another copy took that name; try again");
      }
      throw error;
    }

    // Extraction only. Labelling is paid, so the copy is labelled by the
    // scheduled sweep like any other document, never on this request.
    nudgeFileExtraction();

    return ok(
      c,
      copiedDriveFileSchema.parse({
        name,
        fileUrl: copied.url,
        pathname: copied.pathname,
        size: source.size,
        uploadedAt: new Date().toISOString(),
        dataRoom: copied.store.access === "private",
        resourceId,
      }),
    );
  });
}
