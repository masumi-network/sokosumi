import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFilePathnameWithFolder,
  buildUserDriveFilePathnameWithFolder,
  clampDriveFileName,
  FILE_UPLOAD_MAX_SIZE_BYTES,
  isDriveFolderMarkerName,
  normalizeDriveFolderPath,
  resolveUserUploadContentType,
} from "@sokosumi/utils";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { copyAttemptName } from "@/helpers/drive-copy-name";
import {
  requireOrganizationDriveFileUploadAccess,
  requireUserDriveFileUploadAccess,
} from "@/helpers/drive-file-access";
import { publishStagedUpload } from "@/helpers/drive-staged-upload";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import {
  badRequest,
  conflict,
  payloadTooLarge,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { createBlobUploadGrant } from "@/lib/blob-upload-grant";
import {
  driveExists,
  driveHasAny,
  driveWriteStore,
  stagedUploadPathname,
} from "@/lib/drive-blob";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  createDriveFileUploadSessionRequestSchema,
  driveFileUploadSessionSchema,
} from "@/schemas/drive-file.schema";
import {
  claimedDriveUploadAttempt,
  reserveDriveUploadResource,
} from "@/services/file-catalog.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description: [
      "Mint a direct upload session for a drive file (personal or organization).",
      "Bytes go client → Vercel Blob (not through this API).",
      "Drive uses exact pathnames (addRandomSuffix: false).",
      "409 if target pathname already exists.",
      "",
      "Agent / REST:",
      "1. POST this endpoint with `filename`, `contentType`, `size`, and `scope` (+ `organizationId` if scope=org).",
      "2. PUT raw bytes to `uploadUrl` with `Content-Type` from `headers`.",
      "3. Done — file is immediately available via pathname.",
      "",
      "Staged (opt in with `staged: true`; always for `pinLabelsEmpty`): the PUT",
      "writes a staging key bound to the session's `attemptId`, and the file is",
      "in Drive only after `POST /drive/files/finalize` with `pathname` and",
      "`attemptId`. A late write from that grant never reaches a Drive pathname.",
      "",
      `Max size: ${FILE_UPLOAD_MAX_SIZE_BYTES} bytes. MIME allowlist matches user uploads (including SVG for drive).`,
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: createDriveFileUploadSessionRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        driveFileUploadSessionSchema,
        "Drive file upload session created",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict - target pathname already exists"),
      413: jsonErrorResponse("Payload Too Large"),
      422: jsonErrorResponse("Unprocessable Entity"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);

    const body = c.req.valid("json");

    if (body.size > FILE_UPLOAD_MAX_SIZE_BYTES) {
      throw payloadTooLarge(
        `File is too large. Maximum size is ${FILE_UPLOAD_MAX_SIZE_BYTES} bytes.`,
      );
    }

    const resolvedContentType = resolveUserUploadContentType(
      body.filename,
      body.contentType,
    );
    if (!resolvedContentType) {
      throw badRequest(
        `Unsupported content type. Allowed types match user uploads (e.g. application/pdf, image/png, image/svg+xml, text/plain).`,
      );
    }

    // A copy gets its own name per attempt: its grant and its pinned
    // reservation are bound to a key nobody else can address before its
    // bytes land. Ordinary uploads keep the exact name they were given.
    const displayName = body.pinLabelsEmpty
      ? copyAttemptName(clampDriveFileName(body.filename || "file"))
      : clampDriveFileName(body.filename || "file");
    const folderPath = normalizeDriveFolderPath(body.folder ?? "");

    if (isDriveFolderMarkerName(displayName)) {
      throw badRequest(
        "File name conflicts with a reserved system name. Please choose a different name.",
      );
    }

    let pathname: string;

    if (body.scope === "me") {
      const ownerId = userContext.userId;
      await requireUserDriveFileUploadAccess(authContext, ownerId);
      pathname = buildUserDriveFilePathnameWithFolder(
        ownerId,
        folderPath,
        displayName,
      );
    } else if (body.scope === "org") {
      if (!body.organizationId) {
        throw unprocessableEntity("organizationId is required when scope=org");
      }
      const ownerId = body.organizationId;
      await requireOrganizationDriveFileUploadAccess(authContext, ownerId, {
        into: [folderPath],
      });
      pathname = buildOrganizationDriveFilePathnameWithFolder(
        ownerId,
        folderPath,
        displayName,
      );
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    const workspace = await resolveDriveTasksWorkspace({
      userContext,
      scope: body.scope,
      organizationId: body.organizationId,
    });
    const key = {
      workspaceId: workspace.workspaceId,
      scope:
        body.scope === "me" ? ("user" as const) : ("organization" as const),
      ownerId:
        body.scope === "me"
          ? userContext.userId
          : (body.organizationId as string),
      pathname,
    };
    // An earlier staged publication that its request never resolved still
    // owns this name; finish it first, so the name is never stuck and its
    // bytes are never mistaken for this upload's. Failing that, the
    // reservation below answers 409.
    const claimed = await claimedDriveUploadAttempt(key);
    if (claimed) await publishStagedUpload(key, claimed).catch(() => undefined);

    if (await driveExists(pathname)) {
      throw conflict("Target pathname already exists");
    }
    if (await driveHasAny(`${pathname}/`)) {
      throw conflict("A folder with that name already exists");
    }

    // Reserve the document's identity before any bytes exist, so the
    // finalize callback has something to authenticate against and an
    // abandoned grant is visible rather than invisible. A staged grant writes
    // only the reserved version's staging key, so its bytes reach `pathname`
    // only through finalize, and a late write from it never lands on a Drive
    // pathname. A copy is always staged.
    const staged = body.staged === true || body.pinLabelsEmpty === true;
    const { versionId } = await reserveDriveUploadResource({
      key,
      displayName,
      mimeType: resolvedContentType,
      sizeBytes: body.size,
      pinLabelsEmpty: body.pinLabelsEmpty
        ? { decidedByUserId: userContext.userId }
        : undefined,
      staged,
    });

    const store = await driveWriteStore(pathname);
    const grant = await createBlobUploadGrant({
      pathname: staged ? stagedUploadPathname(versionId, pathname) : pathname,
      access: store.access,
      contentType: resolvedContentType,
      maximumSizeInBytes: body.size,
      maxSizeBytes: FILE_UPLOAD_MAX_SIZE_BYTES,
      addRandomSuffix: false,
      token: store.token,
    });

    const session = {
      uploadUrl: grant.uploadUrl,
      pathname,
      ...(staged ? { attemptId: versionId } : {}),
      access: grant.access,
      method: "PUT" as const,
      headers: {
        "Content-Type": resolvedContentType,
      },
      expiresAt: grant.expiresAt,
      maxSizeBytes: FILE_UPLOAD_MAX_SIZE_BYTES,
      addRandomSuffix: false,
    };

    return created(c, driveFileUploadSessionSchema.parse(session));
  });
}
