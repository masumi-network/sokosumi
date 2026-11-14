import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  DATA_ROOM_SESSION_HEADER,
  dataRoomViewSchema,
  toDataRoomTreeRowDto,
} from "@/schemas/data-room.schema";
import { resolveDataRoomViewer } from "@/services/data-room-access.service";
import { dataRoomName } from "@/services/data-room-email.service";
import {
  buildDataRoomTree,
  dataRoomOrder,
  listDataRoomFiles,
} from "@/services/data-room-files.service";

const route = createRoute({
  method: "get",
  path: "/{token}",
  description: [
    "A data room as its viewer sees it.",
    "Signed out, only its title and whether it is open; signed in (session header), the files they may see, in order and numbered.",
  ].join("\n"),
  tags: ["Share"],
  security: [],
  request: { params: z.object({ token: z.string().max(200) }) },
  responses: {
    200: jsonSuccessResponse(dataRoomViewSchema, "Data room"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const viewer = await resolveDataRoomViewer({
      token: c.req.valid("param").token,
      session: c.req.header(DATA_ROOM_SESSION_HEADER),
    });
    if (viewer.kind === "missing") throw notFound("Data room not found");
    const { room } = viewer;
    const base = {
      title: dataRoomName(room),
      hasLogo: room.logoFileId !== null,
      allowDownload: room.allowDownload,
      watermark: room.watermark,
    };
    if (viewer.kind !== "in")
      return ok(
        c,
        dataRoomViewSchema.parse({
          ...base,
          state: viewer.kind === "closed" ? viewer.reason : "out",
          // The note is for the people let in, like the files.
          welcomeNote: null,
          viewer: null,
          rows: [],
        }),
      );
    const [files, order] = await Promise.all([
      listDataRoomFiles(room),
      dataRoomOrder(room.id),
    ]);
    return ok(
      c,
      dataRoomViewSchema.parse({
        ...base,
        state: "in",
        welcomeNote: room.welcomeNote,
        viewer: { email: viewer.member.email, name: viewer.member.name },
        rows: buildDataRoomTree({ files, order, member: viewer.member }).map(
          toDataRoomTreeRowDto,
        ),
      }),
    );
  });
}
