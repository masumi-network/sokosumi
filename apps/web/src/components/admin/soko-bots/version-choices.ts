import {
  CMO_SOKO_BOT_VERSION_ID,
  CMO_SOKO_BOT_VERSION_IDS,
  SOKO_BOT_PRODUCT_VERSIONS,
} from "@sokosumi/soko-bot";

interface VersionChoice {
  id: string;
  name: string;
}

/**
 * The versions a bot may move to: a Cuso only between CMO's versions, any
 * other bot only between Soko Bot versions. A Cuso on a Soko Bot version
 * stops being Cuso.
 */
export function versionChoices(
  currentVersionId: string | null,
  sokoBot: { versions: VersionChoice[]; defaultVersionId: string },
): { versions: VersionChoice[]; defaultVersionId: string } {
  if (!currentVersionId || !CMO_SOKO_BOT_VERSION_IDS.includes(currentVersionId))
    return {
      versions: sokoBot.versions.map(({ id, name }) => ({ id, name })),
      defaultVersionId: sokoBot.defaultVersionId,
    };
  return {
    versions: SOKO_BOT_PRODUCT_VERSIONS.filter((version) =>
      CMO_SOKO_BOT_VERSION_IDS.includes(version.id),
    ).map(({ id, name }) => ({ id, name })),
    defaultVersionId: CMO_SOKO_BOT_VERSION_ID,
  };
}
