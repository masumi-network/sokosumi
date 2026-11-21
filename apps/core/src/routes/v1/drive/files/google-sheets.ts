import { createRoute } from "@hono/zod-openapi";
import { normalizeDriveFolderPath } from "@sokosumi/utils";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  requireOrganizationDriveFileUploadAccess,
  requireUserDriveFileUploadAccess,
} from "@/helpers/drive-file-access";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import {
  conflict,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  driveGoogleSheetSchema,
  linkDriveGoogleSheetRequestSchema,
} from "@/schemas/drive-file.schema";
import {
  GoogleSheetExportError,
  GoogleSheetNameTakenError,
  googleSpreadsheetId,
  linkGoogleSheet,
} from "@/services/drive-google-sheet.service";

const linkRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/google-sheets",
    description: [
      "Save Google's PDF of a Google Sheet into Drive, read through its share link.",
      "The sheet must be shared as 'Anyone with the link can view'. Sokosumi",
      "reads it again every hour and rewrites the copy when it changed.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: linkDriveGoogleSheetRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(driveGoogleSheetSchema, "Google Sheet linked"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict - a file with that name exists"),
      422: jsonErrorResponse(
        "Unprocessable Entity - not a Google Sheets link, or not shared",
      ),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const EXPORT_ERROR_MESSAGES = {
  not_shared:
    "Sokosumi can't open that sheet. In Google Sheets, set Share → General access to 'Anyone with the link'.",
  too_large: "That sheet is too large to copy.",
  failed: "Google Sheets did not answer. Try again in a minute.",
} as const;

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(linkRoute, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
    const body = c.req.valid("json");

    const spreadsheetId = googleSpreadsheetId(body.url);
    if (!spreadsheetId)
      throw unprocessableEntity("That is not a Google Sheets link.");

    const folder = normalizeDriveFolderPath(body.folder ?? "");
    if (body.scope === "org") {
      if (!body.organizationId)
        throw unprocessableEntity("organizationId is required when scope=org");
      await requireOrganizationDriveFileUploadAccess(
        authContext,
        body.organizationId,
        { into: [folder] },
      );
    } else {
      await requireUserDriveFileUploadAccess(authContext, userContext.userId);
    }
    const workspace = await resolveDriveTasksWorkspace({
      userContext,
      scope: body.scope,
      organizationId: body.organizationId,
    });

    try {
      const link = await linkGoogleSheet({
        workspaceId: workspace.workspaceId,
        organizationId:
          body.scope === "org" ? (body.organizationId ?? null) : null,
        userId: userContext.userId,
        folder,
        spreadsheetId,
      });
      return created(c, driveGoogleSheetSchema.parse(link));
    } catch (error) {
      if (error instanceof GoogleSheetNameTakenError)
        throw conflict(`A file named ${error.message} is already here.`);
      if (error instanceof GoogleSheetExportError)
        throw error.reason === "failed"
          ? serviceUnavailable(EXPORT_ERROR_MESSAGES.failed)
          : unprocessableEntity(EXPORT_ERROR_MESSAGES[error.reason]);
      throw error;
    }
  });
}
