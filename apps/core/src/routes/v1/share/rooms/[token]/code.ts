import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { getEmailLocale } from "@sokosumi/utils";

import { gone, notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { dataRoomCodeRequestSchema } from "@/schemas/data-room.schema";
import { requestDataRoomCode } from "@/services/data-room-access.service";
import { sendDataRoomCode } from "@/services/data-room-email.service";

const route = createRoute({
  method: "post",
  path: "/{token}/code",
  description: [
    "Email a one-time sign-in code to someone let into the room.",
    "Answers the same whether or not the email is in, so the form tells nobody who is.",
  ].join("\n"),
  tags: ["Share"],
  security: [],
  request: {
    params: z.object({ token: z.string().max(200) }),
    body: {
      required: true,
      content: { "application/json": { schema: dataRoomCodeRequestSchema } },
    },
  },
  responses: {
    204: { description: "If the email is let in, a code is on its way" },
    404: jsonErrorResponse("Not Found"),
    410: jsonErrorResponse("Closed or expired"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const outcome = await requestDataRoomCode({
      token: c.req.valid("param").token,
      email: c.req.valid("json").email,
    });
    if (outcome.kind === "missing") throw notFound("Data room not found");
    if (outcome.kind === "closed")
      throw gone(
        outcome.reason === "expired"
          ? "This data room has expired."
          : "This data room is closed.",
      );
    if (outcome.kind === "sent")
      await sendDataRoomCode({
        room: outcome.room,
        member: outcome.member,
        code: outcome.code,
        locale: getEmailLocale(c.req.raw),
      });
    return c.body(null, 204);
  });
}
