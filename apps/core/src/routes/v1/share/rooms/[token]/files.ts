import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import {
  openDataRoomFile,
  zipDataRoom,
} from "@/services/data-room-files.service";
import {
  contentDispositionFor,
  contentSecurityPolicyFor,
} from "@/services/file-content.service";
import { requireDataRoomViewer } from "./viewer.js";

const fileRoute = createRoute({
  method: "get",
  path: "/{token}/files/{resourceId}",
  description: [
    "One file of a data room, for its signed-in viewer (session header).",
    "Stamped with their email and the time when the room says so; a download only when the room allows downloads. Every open is logged.",
  ].join("\n"),
  tags: ["Share"],
  security: [],
  request: {
    params: z.object({
      token: z.string().max(200),
      resourceId: z.string().uuid(),
    }),
    query: z.object({ download: z.enum(["true", "false"]).optional() }),
  },
  responses: {
    200: {
      description: "File bytes",
      content: { "*/*": { schema: { type: "string", format: "binary" } } },
    },
    401: jsonErrorResponse("Not signed in"),
    403: jsonErrorResponse("Downloads are off"),
    404: jsonErrorResponse("Not Found"),
    410: jsonErrorResponse("Closed or expired"),
    413: jsonErrorResponse("Too large to stamp"),
  },
});

const zipRoute = createRoute({
  method: "get",
  path: "/{token}/zip",
  description:
    "Everything the viewer may see in the room, as one zip, when the room allows downloads.",
  tags: ["Share"],
  security: [],
  request: { params: z.object({ token: z.string().max(200) }) },
  responses: {
    200: {
      description: "Zip",
      content: {
        "application/zip": { schema: { type: "string", format: "binary" } },
      },
    },
    401: jsonErrorResponse("Not signed in"),
    403: jsonErrorResponse("Downloads are off"),
    404: jsonErrorResponse("Not Found"),
    410: jsonErrorResponse("Closed or expired"),
    413: jsonErrorResponse("Too large"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(fileRoute, async (c) => {
    const { token, resourceId } = c.req.valid("param");
    const viewer = await requireDataRoomViewer(c, token);
    const content = await openDataRoomFile({
      room: viewer.room,
      member: viewer.member,
      resourceId,
      download: c.req.valid("query").download === "true",
    });
    return c.body(content.stream, 200, {
      "content-type": content.contentType,
      "content-length": String(content.size),
      // Access can end any moment, so nothing keeps a copy to reuse.
      "cache-control": "private, no-store",
      "content-disposition": contentDispositionFor(
        content.name,
        content.inline,
      ),
      "x-content-type-options": "nosniff",
      "content-security-policy": contentSecurityPolicyFor(content.contentType),
    });
  });

  app.openapi(zipRoute, async (c) => {
    const viewer = await requireDataRoomViewer(c, c.req.valid("param").token);
    const zip = await zipDataRoom({ room: viewer.room, member: viewer.member });
    return c.body(new Uint8Array(zip.bytes).buffer, 200, {
      "content-type": "application/zip",
      "content-length": String(zip.bytes.byteLength),
      "cache-control": "private, no-store",
      "content-disposition": contentDispositionFor(zip.name, false),
    });
  });
}
