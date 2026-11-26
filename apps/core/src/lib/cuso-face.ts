import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";

/** Cuso's one face, served by the CMO app. Every Cuso wears it, whatever look he got at hire. */
export const CUSO_FACE_URL = "https://app.cmo.xyz/cuso/face-512.png";

export function isCusoVersion(versionId: string | null | undefined): boolean {
  return versionId != null && CMO_SOKO_BOT_VERSION_IDS.includes(versionId);
}

interface SokoBotFaceFields {
  versionId: string | null;
  avatarImageUrl: string | null;
  avatarCode?: string | null;
}

/** The face a client draws: Cuso's fixed picture, else the bot's own look. */
export function sokoBotFace(bot: SokoBotFaceFields): {
  avatarImageUrl: string | null;
  avatarCode: string | null;
} {
  if (isCusoVersion(bot.versionId)) {
    return { avatarImageUrl: CUSO_FACE_URL, avatarCode: null };
  }
  return {
    avatarImageUrl: bot.avatarImageUrl,
    avatarCode: bot.avatarCode ?? null,
  };
}
