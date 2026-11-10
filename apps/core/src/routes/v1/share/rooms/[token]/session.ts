import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { getEmailLocale } from "@sokosumi/utils";

import { gone, notFound, unauthorized } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  dataRoomSessionRequestSchema,
  dataRoomSessionSchema,
} from "@/schemas/data-room.schema";
import { verifyDataRoomCode } from "@/services/data-room-access.service";
import { notifyDataRoomFirstVisit } from "@/services/data-room-email.service";

const route = createRoute({
  method: "post",
  path: "/{token}/session",
  description:
    "Trade an emailed code for a session. Five wrong codes end the code; the person asks for a new one.",
  tags: ["Share"],
  security: [],
  request: {
    params: z.object({ token: z.string().max(200) }),
    body: {
      required: true,
      content: {
        "application/json": { schema: dataRoomSessionRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(dataRoomSessionSchema, "Signed in"),
    401: jsonErrorResponse("Wrong or expired code"),
    404: jsonErrorResponse("Not Found"),
    410: jsonErrorResponse("Closed or expired"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const body = c.req.valid("json");
    const outcome = await verifyDataRoomCode({
      token: c.req.valid("param").token,
      email: body.email,
      code: body.code,
    });
    if (outcome.kind === "missing") throw notFound("Data room not found");
    if (outcome.kind === "closed")
      throw gone(
        outcome.reason === "expired"
          ? "This data room has expired."
          : "This data room is closed.",
      );
    if (outcome.kind === "wrong")
      throw unauthorized(
        "That code is wrong or has expired. Ask for a new one.",
      );
    if (outcome.firstVisit)
      await notifyDataRoomFirstVisit({
        room: outcome.room,
        member: outcome.member,
        locale: getEmailLocale(c.req.raw),
      });
    return ok(c, dataRoomSessionSchema.parse({ session: outcome.session }));
  });
}
