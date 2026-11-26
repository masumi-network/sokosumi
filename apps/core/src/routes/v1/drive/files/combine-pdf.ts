import { createRoute, z } from "@hono/zod-openapi";
import { FileSourceScope } from "@sokosumi/database";
import {
  buildOrganizationDriveFilePathnameWithFolder,
  buildUserDriveFilePathnameWithFolder,
  clampDriveFileName,
  isDriveFolderMarkerName,
} from "@sokosumi/utils";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  drivePathOf,
  requireDriveFileAccess,
  requireOrganizationDriveFileUploadAccess,
  requireUserDriveFileUploadAccess,
} from "@/helpers/drive-file-access";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import {
  badRequest,
  conflict,
  errorResponseWithExtensionsSchema,
  notFound,
  payloadTooLarge,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  driveDel,
  driveExists,
  driveHasAny,
  driveHead,
  drivePut,
  driveRead,
  driveRoomsOf,
  roomContaining,
} from "@/lib/drive-blob";
import { nudgeFileIndexing } from "@/lib/files/in-process-indexer";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  combinePdfs,
  UnreadablePdfError,
} from "@/services/drive-pdf-combine.service";
import {
  activateDriveUploadResource,
  claimDriveUploadResource,
  releaseDriveUploadClaim,
} from "@/services/file-catalog.service";

/** All sources together; pdf-lib holds them in memory at once. */
export const COMBINE_PDF_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const PDF = "application/pdf";
const TOO_LARGE = `These files add up to more than ${COMBINE_PDF_MAX_TOTAL_BYTES / 1024 / 1024} MB; combine fewer at once`;

const bodySchema = z.object({
  pathnames: z.array(z.string().min(1).max(1_000)).min(2).max(20),
  filename: z.string().trim().min(1).max(200),
});

const responseSchema = z.object({
  resourceId: z.string(),
  name: z.string(),
  pathname: z.string(),
  pageCount: z.number().int(),
});

/** `kind` says what went wrong; `fileName` names the file it is about. */
const namedErrorSchema = errorResponseWithExtensionsSchema({
  fileName: z.string().optional(),
});

function namedError(description: string) {
  return {
    description,
    content: { "application/json": { schema: namedErrorSchema } },
  };
}

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/combine-pdf",
    description: [
      "Combine 2–20 PDFs from one Drive into a new PDF, pages in the order of `pathnames`.",
      "Saved beside the first file as `filename` (.pdf added when missing). The sources stay as they are.",
      `All or nothing: a source that is missing, not a PDF, encrypted or broken fails the whole request, and nothing is saved. Sources total at most ${COMBINE_PDF_MAX_TOTAL_BYTES} bytes.`,
      "Every source and the new file stay inside one data room, or all outside any; a mix is refused (`mixed_data_room`).",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: bodySchema } },
      },
    },
    responses: {
      201: jsonSuccessResponse(responseSchema, "Combined PDF saved"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: namedError("Not Found - a source is gone (`fileName`)"),
      409: namedError("Conflict - `fileName` already exists (`name_taken`)"),
      413: jsonErrorResponse("Payload Too Large (`too_large`)"),
      422: namedError(
        "Unprocessable Entity - `fileName` is not a readable PDF (`unreadable_pdf`), or the files cross a data room (`mixed_data_room`)",
      ),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

function fileName(pathname: string): string {
  return pathname.split("/").at(-1) ?? pathname;
}

/**
 * The stream's bytes, counted against a budget the sources share. HEAD sizes
 * are checked first, but a file replaced since then could be larger, so the
 * cap holds on what is actually read.
 */
async function readWithin(
  stream: ReadableStream<Uint8Array>,
  budget: { left: number },
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    budget.left -= value.byteLength;
    if (budget.left < 0) {
      await reader.cancel();
      throw payloadTooLarge(TOO_LARGE, { kind: "too_large" });
    }
    chunks.push(value);
  }
}

/**
 * Undoes a save that did not go live: this save's bytes first, while its
 * claim still holds the name so nothing else can land there, then the claim.
 * When the bytes cannot be removed the claim stays, keeping the name held
 * rather than leaving bytes no catalog entry answers for.
 */
async function rollBack(
  resourceId: string,
  pathname: string,
  wroteBytes: boolean,
) {
  try {
    if (wroteBytes) await driveDel([pathname]);
  } catch {
    return;
  }
  await releaseDriveUploadClaim(resourceId).catch(() => undefined);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
    const body = c.req.valid("json");

    const owners = body.pathnames.map((pathname) =>
      parseDriveFilePathname(pathname, userContext.userId),
    );
    const [{ scope, ownerId }] = owners;
    if (owners.some((o) => o.scope !== scope || o.ownerId !== ownerId))
      throw unprocessableEntity("Combine files from one Drive");

    const name = clampDriveFileName(
      /\.pdf$/i.test(body.filename) ? body.filename : `${body.filename}.pdf`,
    );
    if (isDriveFolderMarkerName(name))
      throw badRequest("That name is reserved; choose another");

    const paths = body.pathnames.map(drivePathOf);
    const folder = paths[0].split("/").slice(0, -1).join("/");
    await requireDriveFileAccess(authContext, scope, ownerId, {
      changes: paths,
    });
    if (scope === "user")
      await requireUserDriveFileUploadAccess(authContext, ownerId);
    else
      await requireOrganizationDriveFileUploadAccess(authContext, ownerId, {
        into: [folder],
      });

    // Resolved before anything is written, so a failure here leaves nothing.
    const workspace = await resolveDriveTasksWorkspace({
      userContext,
      scope: scope === "user" ? "me" : "org",
      organizationId: scope === "organization" ? ownerId : undefined,
    });

    // A room's pages must not leave it, and outside pages must not land in
    // it: the new file takes its folder's audience and storage.
    const rooms = await driveRoomsOf(
      scope === "user" ? FileSourceScope.USER : FileSourceScope.ORGANIZATION,
      ownerId,
    );
    const roomOf = (path: string) =>
      roomContaining(rooms, path)?.folderPath ?? null;
    const targetRoom = roomOf(folder);
    const outsider = paths.findIndex((path) => roomOf(path) !== targetRoom);
    if (outsider !== -1)
      throw unprocessableEntity(
        "Combine files from one data room, or files outside any room",
        {
          kind: "mixed_data_room",
          extensions: { fileName: fileName(body.pathnames[outsider]) },
        },
      );

    const pathname =
      scope === "user"
        ? buildUserDriveFilePathnameWithFolder(ownerId, folder, name)
        : buildOrganizationDriveFilePathnameWithFolder(ownerId, folder, name);
    const nameTaken = () =>
      conflict(`A file named "${name}" already exists in this folder`, {
        kind: "name_taken",
        extensions: { fileName: name },
      });
    if ((await driveExists(pathname)) || (await driveHasAny(`${pathname}/`)))
      throw nameTaken();

    const heads = await Promise.all(body.pathnames.map((p) => driveHead(p)));
    let total = 0;
    for (const [index, head] of heads.entries()) {
      const source = fileName(body.pathnames[index]);
      if (!head)
        throw notFound(`"${source}" was not found`, {
          extensions: { fileName: source },
        });
      if (head.contentType !== PDF)
        throw unprocessableEntity(`"${source}" is not a PDF`, {
          kind: "unreadable_pdf",
          extensions: { fileName: source },
        });
      total += head.size;
    }
    if (total > COMBINE_PDF_MAX_TOTAL_BYTES)
      throw payloadTooLarge(TOO_LARGE, { kind: "too_large" });

    const budget = { left: COMBINE_PDF_MAX_TOTAL_BYTES };
    const sources = await Promise.all(
      body.pathnames.map(async (p) => {
        const read = await driveRead(p);
        if (!read)
          throw notFound(`"${fileName(p)}" was not found`, {
            extensions: { fileName: fileName(p) },
          });
        return {
          name: fileName(p),
          bytes: await readWithin(read.stream, budget),
        };
      }),
    );

    let combined: Awaited<ReturnType<typeof combinePdfs>>;
    try {
      combined = await combinePdfs(sources);
    } catch (error) {
      if (error instanceof UnreadablePdfError)
        throw unprocessableEntity(
          `"${error.fileName}" could not be read as a PDF (it may be broken or password-protected). Nothing was saved.`,
          { kind: "unreadable_pdf", extensions: { fileName: error.fileName } },
        );
      throw error;
    }

    // The catalog row is the claim on the name. It is create-only, so a live
    // file or another upload still pending there is a conflict, and every
    // step below acts only on the row this save created.
    const key = {
      workspaceId: workspace.workspaceId,
      scope,
      ownerId,
      pathname,
    };
    const sizeBytes = combined.bytes.byteLength;
    const claim = await claimDriveUploadResource({
      key,
      displayName: name,
      mimeType: PDF,
      sizeBytes,
    });
    if (!claim) throw nameTaken();

    let wroteBytes = false;
    let activated: { resourceId: string } | null = null;
    try {
      try {
        await drivePut(pathname, Buffer.from(combined.bytes), {
          contentType: PDF,
          addRandomSuffix: false,
          allowOverwrite: false,
        });
        wroteBytes = true;
      } catch (error) {
        if (await driveExists(pathname)) throw nameTaken();
        throw error;
      }
      const live = await activateDriveUploadResource({
        key,
        sizeBytes,
        mimeType: PDF,
      });
      if (live?.resourceId === claim.resourceId) activated = live;
    } finally {
      if (!activated) await rollBack(claim.resourceId, pathname, wroteBytes);
    }
    if (!activated) throw notFound("The combined file could not be saved");
    nudgeFileIndexing();

    return created(
      c,
      responseSchema.parse({
        resourceId: activated.resourceId,
        name,
        pathname,
        pageCount: combined.pageCount,
      }),
    );
  });
}
