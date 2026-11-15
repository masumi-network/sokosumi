import { createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { badRequest, payloadTooLarge } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  transcribeVoice,
  VOICE_TRANSCRIPTION_CONTENT_TYPES,
  VOICE_TRANSCRIPTION_MAX_BYTES,
} from "@/lib/voice-transcription";
import { requireUserAuthContext } from "@/middleware/auth";

const transcriptionSchema = z
  .object({ text: z.string() })
  .openapi("VoiceTranscription");

const audioBody = { schema: z.string().openapi({ format: "binary" }) };

const route = createRoute({
  method: "post",
  path: "/",
  operationId: "transcribeVoice",
  tags: ["Chat Rooms"],
  description:
    "Turn a voice recording into text, for dictation in the composer and voice message transcripts. Send raw MP4 or WebM audio bytes (not multipart), up to 10 MiB, with the type in Content-Type. Nothing is stored.",
  request: {
    body: {
      required: true,
      content: { "audio/mp4": audioBody, "audio/webm": audioBody },
    },
  },
  responses: {
    200: jsonSuccessResponse(transcriptionSchema, "What was said"),
    400: jsonErrorResponse("Invalid audio"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    413: jsonErrorResponse("Recording too large"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.use(
    "/",
    bodyLimit({
      maxSize: VOICE_TRANSCRIPTION_MAX_BYTES,
      onError: () => {
        throw payloadTooLarge("Keep recordings under 10 MiB.");
      },
    }),
  );
  app.openapi(route, async (c) => {
    requireUserAuthContext(c.var.authContext);
    const declaredType = c.req
      .header("Content-Type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (
      !declaredType ||
      !VOICE_TRANSCRIPTION_CONTENT_TYPES.includes(declaredType)
    )
      throw badRequest("Send MP4 or WebM audio.");
    const audio = new Uint8Array(await c.req.arrayBuffer());
    if (audio.length === 0) throw badRequest("The recording is empty.");
    return ok(c, { text: await transcribeVoice(audio) });
  });
}
