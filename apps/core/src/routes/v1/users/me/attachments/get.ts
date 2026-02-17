import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { attachmentsSchema } from "@/schemas/attachment.schema";

interface AttachmentRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  url: string;
  name: string;
  mimeType: string;
  size: bigint;
  jobInputId: string;
}

export function mapAttachmentForResponse(
  attachment: AttachmentRow,
  userId: string,
) {
  return {
    id: attachment.id,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
    userId,
    referenceId: attachment.jobInputId,
    referenceType: "Input" as const,
    name: attachment.name,
    size: Number(attachment.size),
    mimeType: attachment.mimeType,
    url: attachment.url,
  };
}

const route = createRoute({
  method: "get",
  path: "/attachments",
  description: "Get all attachments the current user has made",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(
      attachmentsSchema,
      "Retrieve attachments by current user",
      {
        data: [
          {
            id: "blob_456",
            createdAt: "2025-01-15T11:00:00.000Z",
            updatedAt: "2025-01-15T11:00:00.000Z",
            userId: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
            referenceId: "cmi4gmksz000104l8wps8p8fp",
            referenceType: "Input",
            name: "report.pdf",
            size: 2048000,
            mimeType: "application/pdf",
            url: "https://blob.vercel.app/report.pdf",
          },
        ],
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;

    const attachments = await prisma.attachment.findMany({
      where: {
        jobInput: { event: { job: { userId: authContext.userId } } },
      },
    });

    const attachmentsList = attachments.map((attachment) =>
      mapAttachmentForResponse(attachment, authContext.userId),
    );

    return ok(c, attachmentsSchema.parse(attachmentsList));
  });
}
