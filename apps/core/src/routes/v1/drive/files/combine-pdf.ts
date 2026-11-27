import { createRoute, z } from "@hono/zod-openapi";
import { FileSourceScope } from "@sokosumi/database";
import { clampDriveFileName } from "@sokosumi/utils";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  drivePathOf,
  requireDriveFileAccess,
} from "@/helpers/drive-file-access";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import {
  errorResponseWithExtensionsSchema,
  notFound,
  payloadTooLarge,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import {
  driveHead,
  driveRead,
  driveRoomsOf,
  roomContaining,
} from "@/lib/drive-blob";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  combinePdfs,
  UnreadablePdfError,
} from "@/services/drive-pdf-combine.service";
import { contentDispositionFor } from "@/services/file-content.service";

/** All sources together; pdf-lib holds them in memory at once. */
export const COMBINE_PDF_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const PDF = "application/pdf";
const TOO_LARGE = `These files add up to more than ${COMBINE_PDF_MAX_TOTAL_BYTES / 1024 / 1024} MB; combine fewer at once`;

const bodySchema = z.object({
  pathnames: z.array(z.string().min(1).max(1_000)).min(2).max(20),
  filename: z.string().trim().min(1).max(200),
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
      "Combine 2–20 PDFs from one Drive into one PDF, pages in the order of `pathnames`, and return it as a download named `filename` (.pdf added when missing).",
      "Nothing is saved: the sources stay as they are and Drive does not change.",
      "Access is the same as downloading each source (`GET /drive/files/content`). A data room's download and watermark settings apply to its share-link viewers, who cannot call this.",
      `All or nothing: a source that is missing, not a PDF, encrypted or broken fails the whole request. Sources total at most ${COMBINE_PDF_MAX_TOTAL_BYTES} bytes.`,
      "Every source is inside one data room, or all are outside any; a mix is refused (`mixed_data_room`).",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: bodySchema } },
      },
    },
    responses: {
      200: {
        description: "The combined PDF",
        content: {
          [PDF]: { schema: { type: "string", format: "binary" } },
        },
      },
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: namedError("Not Found - a source is gone (`fileName`)"),
      413: jsonErrorResponse("Payload Too Large (`too_large`)"),
      422: namedError(
        "Unprocessable Entity - `fileName` is not a readable PDF (`unreadable_pdf`), or the files cross a data room (`mixed_data_room`)",
      ),
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

    const paths = body.pathnames.map(drivePathOf);
    await requireDriveFileAccess(authContext, scope, ownerId, {
      changes: paths,
    });

    // A room's pages are never mixed with pages from outside it.
    const rooms = await driveRoomsOf(
      scope === "user" ? FileSourceScope.USER : FileSourceScope.ORGANIZATION,
      ownerId,
    );
    const roomOf = (path: string) =>
      roomContaining(rooms, path)?.folderPath ?? null;
    const firstRoom = roomOf(paths[0]);
    const outsider = paths.findIndex((path) => roomOf(path) !== firstRoom);
    if (outsider !== -1)
      throw unprocessableEntity(
        "Combine files from one data room, or files outside any room",
        {
          kind: "mixed_data_room",
          extensions: { fileName: fileName(body.pathnames[outsider]) },
        },
      );

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
          `"${error.fileName}" could not be read as a PDF (it may be broken or password-protected)`,
          { kind: "unreadable_pdf", extensions: { fileName: error.fileName } },
        );
      throw error;
    }

    // Streamed, as a data room's stamped files are: a buffered function
    // response is capped far below what a combined PDF can weigh.
    const { bytes } = combined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return c.body(stream, 200, {
      "content-type": PDF,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
      "content-disposition": contentDispositionFor(name, false),
      "x-content-type-options": "nosniff",
    });
  });
}
