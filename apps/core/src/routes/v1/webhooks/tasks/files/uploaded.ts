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
import { defaultValidationHook } from "@/lib/hono";
import {
  registerTaskFileFromUploadCompleted,
  TaskFileUploadClientError,
} from "@/lib/task-file-upload-completed";

/**
 * Public Blob webhook — no session/Bearer auth.
 * Verified via Ed25519 `x-vercel-signature` + `BLOB_WEBHOOK_PUBLIC_KEY`.
 * Task id comes from mint-time `tokenPayload`, not the URL.
 */
const route = createRoute({
  method: "post",
  path: "/uploaded",
  description: [
    "Vercel Blob `onUploadCompleted` callback for task file client uploads.",
    "Not for agents — Blob calls this after a successful PUT to a task-file presigned URL.",
    "Verifies `x-vercel-signature` with `BLOB_WEBHOOK_PUBLIC_KEY`, then creates the TaskFile row",
    "(task id and metadata come from the mint-time tokenPayload; size from Blob head).",
  ].join(" "),
  tags: ["Webhooks"],
  security: [],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              type: z.string(),
            })
            .passthrough()
            .openapi("TaskFileUploadedWebhookBody"),
        },
      },
    },
  },
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

  const body = (await c.req.json()) as HandleUploadPresignedBody;

  try {
    const result = await handleUploadPresigned({
      body,
      request: c.req.raw,
      webhookPublicKey,
      getSignedToken: async () => {
        throw new TaskFileUploadClientError(
          "This endpoint only accepts blob.upload-completed callbacks",
        );
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        await registerTaskFileFromUploadCompleted({
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
      error instanceof TaskFileUploadClientError ||
      error instanceof BlobError
    ) {
      throw badRequest(message);
    }

    throw internalServerError(message);
  }
});

export default app;
