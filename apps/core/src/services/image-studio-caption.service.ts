import { generateText } from "ai";
import { err, ok, type Result } from "neverthrow";

import prisma from "@/lib/db/prisma";
import { sokoBotModelRequest } from "@/lib/soko-bot/model-policy";

const CAPTION_MODEL = "anthropic/claude-haiku-4.5";
const CAPTION_MAX_CHARS = 500;

export type CaptionWriteError = "missing" | "empty";

/**
 * A social caption for a studio image, written the same way Soko Bot writes.
 *
 * The stored prompt is the brief. The image itself is not sent: the person
 * already has it on screen, and the prompt is what they asked the model to
 * make. Nothing is stored — the browser holds the text until they schedule.
 */
export async function writeStudioAssetCaption(options: {
  projectId: string;
  assetId: string;
}): Promise<Result<string, CaptionWriteError>> {
  const asset = await prisma.projectImageAsset.findFirst({
    where: { id: options.assetId, projectId: options.projectId },
    select: { prompt: true },
  });
  if (!asset) return err("missing");

  const { text } = await generateText({
    ...sokoBotModelRequest({
      role: "agent",
      model: CAPTION_MODEL,
    }),
    system:
      "Write a social-media caption for an image. Use the brief. One or two short sentences. No quotation marks. No hashtag list.",
    prompt: asset.prompt,
    maxOutputTokens: 200,
  });

  const caption = text.replace(/^["'\s]+|["'\s]+$/g, "").trim();
  if (!caption) return err("empty");
  return ok(caption.slice(0, CAPTION_MAX_CHARS));
}
