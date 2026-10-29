import type {
  SokoBotAvatarState,
  SokoBotAvatarView,
} from "@sokosumi/core-client";

/** The style id of the mascots drawn before crafted avatars: one image, no states. */
const LEGACY_STYLE_ID = "mascot";

/** How long a state plays when it changes, before the face rests on its still. */
export const AVATAR_PLAY_ONCE_MS = 4_000;

/** Crafted avatars are scenes cropped to the face; a mascot is already a face. */
export function isCraftedAvatar(
  avatar: SokoBotAvatarView | null | undefined,
): avatar is SokoBotAvatarView {
  return avatar != null && avatar.styleId !== LEGACY_STYLE_ID;
}

export interface AvatarSources {
  crafted: boolean;
  /** The state's still, else the idle still, else the bot's single image. */
  still: string | null;
  /** 320 px animated WebP; null for a legacy avatar or a loop not yet rendered. */
  loop: string | null;
  /** 560 px animated WebP. */
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
