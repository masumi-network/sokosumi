import type {
  SokoBotAvatarState,
  SokoBotAvatarView,
} from "@sokosumi/core-client";

/** The style id of the mascots drawn before crafted avatars: one image, no states. */
const LEGACY_STYLE_ID = "mascot";

/**
 * Crafted avatars are scenes cropped to the face; a mascot is already a face.
 * Summaries that carry only a bot's style id (task and chat participants) ask
 * this; a null id means the bot has no claimed avatar.
 */
export function isCraftedStyle(styleId: string | null | undefined): boolean {
  return styleId != null && styleId !== LEGACY_STYLE_ID;
}

export function isCraftedAvatar(
  avatar: SokoBotAvatarView | null | undefined,
): avatar is SokoBotAvatarView {
  return isCraftedStyle(avatar?.styleId);
}

export interface AvatarSources {
  crafted: boolean;
  /** The state's still, else the idle still, else the bot's single image. */
  still: string | null;
  /** 480 px MP4; null for a legacy avatar or a loop not yet rendered. */
  loop: string | null;
  /** 960 px MP4. */
  loopLarge: string | null;
}

/** Where to find the picture for `state`, falling back one step at a time. */
export function avatarSources(
  avatar: SokoBotAvatarView | null | undefined,
  state: SokoBotAvatarState,
  imageUrl: string | null,
): AvatarSources {
  const crafted = isCraftedAvatar(avatar);
  const assets = crafted ? avatar.states[state] : null;
  return {
    crafted,
    still: assets?.stillUrl ?? (crafted ? avatar.stillUrl : null) ?? imageUrl,
    loop: assets?.loopUrl ?? null,
    loopLarge: assets?.loopLargeUrl ?? null,
  };
}
