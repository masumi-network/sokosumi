import type { ProjectImageSettings } from "@sokosumi/core-client";
import { z } from "zod";

export const CURATED_IMAGE_MODEL_IDS = ["gemini-pro", "ideogram-v3"] as const;

export const studioSelectionSchema = z.object({
  studioModelId: z.string().min(1).max(120).nullable().optional(),
  studioSettings: z
    .object({
      aspectRatio: z.enum([
        "1:1",
        "4:3",
        "3:4",
        "16:9",
        "9:16",
        "3:2",
        "2:3",
        "4:5",
        "5:4",
      ]),
      resolution: z.enum(["0.5K", "1K", "2K"]),
      outputFormat: z.enum(["png", "jpeg", "webp"]),
      seed: z.number().int().min(0).max(2147483647).nullable(),
    })
    .partial()
    .optional(),
});

interface PinnedSelection extends ProjectImageSettings {
  modelId?: string;
}

export function pinnedSelectionFrom(ctx: {
  session: {
    auth: {
      current?: { attributes?: Record<string, unknown> | null } | null;
    };
  };
}): PinnedSelection {
  const encoded = ctx.session.auth.current?.attributes?.sokosumiStudioSelection;
  if (encoded === undefined) return {};
  if (typeof encoded !== "string") {
    throw new Error("Invalid Studio model selection.");
  }
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error("Invalid Studio model selection.");
  }
  const parsed = studioSelectionSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid Studio model selection.");
  const selection = parsed.data;
  return selection.studioModelId
    ? { modelId: selection.studioModelId, ...selection.studioSettings }
    : {};
}
