import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { BlobError } from "@vercel/blob";
import {
  type HandleUploadPresignedBody,
  handleUploadPresigned,
} from "@vercel/blob/client";

import { getEnv } from "@/config/env";
import {
  badRequest,
  internalServerError,
  serviceUnavailable,
} from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import {
  DriveFileUploadClientError,
  registerDriveFileFromUploadCompleted,
} from "@/lib/drive-file-upload-completed";
import { defaultValidationHook } from "@/lib/hono";

/**
 * Public Blob webhook — no session/Bearer auth.
 * Verified via Ed25519 `x-vercel-signature` + `BLOB_WEBHOOK_PUBLIC_KEY`.
 * Owner id and scope come from mint-time `tokenPayload`, not the URL.
 *
 * Body schema is intentionally not OpenAPI-validated: Vercel Blob's
 * `onUploadCompleted` callback may omit `Content-Type: application/json`,
 * and `@hono/zod-openapi` then skips JSON parse → false 422s.
 */
const route = createRoute({
  method: "post",
  path: "/uploaded",
  description: [
    "Vercel Blob `onUploadCompleted` callback for drive file client uploads.",
    "Not for agents — Blob calls this after a successful PUT to a drive-file presigned URL.",
    "Verifies `x-vercel-signature` with `BLOB_WEBHOOK_PUBLIC_KEY`, then creates the DriveFile row",
    "(owner id/scope and metadata come from the mint-time tokenPayload; size from Blob head).",
  ].join(" "),
  tags: ["Webhooks"],
  security: [],
  responses: {
    200: {
      description: "Upload completion handled",
      content: {
        "application/json": {
          schema: z
            .object({
              type: z.string(),
              response: z.string().optional(),
            })
            .passthrough(),
        },
      },
    },
    400: jsonErrorResponse("Bad Request"),
    500: jsonErrorResponse("Internal Server Error"),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

const app = new OpenAPIHono({
  defaultHook: defaultValidationHook,
});

function parseUploadCompletedBody(raw: string): HandleUploadPresignedBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("Invalid JSON body");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("type" in parsed) ||
    typeof (parsed as { type: unknown }).type !== "string"
  ) {
    throw badRequest("Invalid upload completion body");
  }

  return parsed as HandleUploadPresignedBody;
}

app.openapi(route, async (c) => {
  const env = getEnv();
  const webhookPublicKey = env.BLOB_WEBHOOK_PUBLIC_KEY;
  if (!webhookPublicKey) {
    throw serviceUnavailable(
      "Blob upload completion is not configured (BLOB_WEBHOOK_PUBLIC_KEY)",
    );
  }

  const blobToken = env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw serviceUnavailable("Blob storage is not configured");
  }

  const body = parseUploadCompletedBody(await c.req.text());

  try {
    const result = await handleUploadPresigned({
      body,
      request: c.req.raw,
      webhookPublicKey,
      getSignedToken: async () => {
        throw new DriveFileUploadClientError(
          "This endpoint only accepts blob.upload-completed callbacks",
        );
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        await registerDriveFileFromUploadCompleted({
          blob,
          tokenPayload,
          blobToken,
        });
      },
    });

    return c.json(result, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Upload completion failed";

    if (
      error instanceof DriveFileUploadClientError ||
      error instanceof BlobError
    ) {
      throw badRequest(message);
    }

    throw internalServerError(message);
  }
});

export default app;
