import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { FileResourceLifecycle } from "@sokosumi/database";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import { driveRead } from "@/lib/drive-blob";

const route = createRoute({
  method: "get",
  path: "/{token}/logo",
  description:
    "The logo the owner chose for the room, shown on its sign-in page too, so no session is needed.",
  tags: ["Share"],
  security: [],
  request: { params: z.object({ token: z.string().max(200) }) },
  responses: {
    200: {
      description: "Image",
      content: { "image/*": { schema: { type: "string", format: "binary" } } },
    },
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const room = await prisma.dataRoom.findUnique({
      where: { token: c.req.valid("param").token },
      select: { workspaceId: true, logoFileId: true },
    });
    if (!room?.logoFileId) throw notFound("No logo");
    const logo = await prisma.fileResource.findFirst({
      where: {
        id: room.logoFileId,
        workspaceId: room.workspaceId,
        lifecycle: FileResourceLifecycle.ACTIVE,
        tombstonedAt: null,
      },
      select: { sourceId: true, mimeType: true },
    });
    if (
      !logo?.mimeType?.startsWith("image/") ||
      logo.mimeType === "image/svg+xml"
    )
      throw notFound("No logo");
    const read = await driveRead(logo.sourceId);
    if (!read) throw notFound("No logo");
    return c.body(read.stream, 200, {
      "content-type": logo.mimeType,
      "content-length": String(read.size),
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    });
  });
}
