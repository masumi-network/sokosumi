import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { z } from "zod";
import { getImageCatalog, imageModel } from "@/lib/image-studio/catalog";
import { SokoBotRuntimeValidationError } from "../soko-bot-runtime.service";

export type SocialMediaInput = NonNullable<
  z.infer<(typeof SOKO_BOT_TOOL_INPUT_SCHEMAS)["create_social_post"]>["media"]
>[number];

export type SocialMediaRef = Exclude<SocialMediaInput, { fileId: string }>;

/** Where the owner sees a Project's images, or one version of them. */
export function studioLink(projectId: string, assetId?: string | null): string {
  const base = `/studio?projectId=${encodeURIComponent(projectId)}`;
  return assetId ? `${base}&v=${encodeURIComponent(assetId)}` : base;
}

/**
 * The image model a bot asked for, or the studio's default. An unknown id
 * names the shortlist, so the bot can pick again in the same turn.
 */
export function botImageModel(id: string | undefined) {
  try {
    return imageModel(id);
  } catch {
    const shortlist = getImageCatalog()
      .models.filter((model) => model.curatedRank !== null)
      .map((model) => `${model.id} (${model.label})`)
      .join(", ");
    throw new SokoBotRuntimeValidationError(
      `There is no image model "${id}". Leave model out for the default, or use one of ${shortlist}.`,
    );
  }
}
