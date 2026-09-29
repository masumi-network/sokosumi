import {
  SOCIAL_POST_MEDIA_REQUIREMENTS,
  SOCIAL_POST_MEDIA_RULES,
  SOCIAL_POST_TEXT_REQUIRED,
  type SocialPostMediaRef,
  type SocialPostMediaValidationReason,
  type SocialPostProvider,
  validateSocialPostMedia,
} from "@sokosumi/utils";

/** Why a post cannot be saved yet, or null when the composer may submit. */
export type SocialPostComposerIssue =
  | "text_required"
  | "text_or_media_required"
  | "media_required"
  | "video_required"
  | SocialPostMediaValidationReason;

/**
 * Composer-side view of the provider's rules; the server enforces the same
 * rules authoritatively on create, update, and schedule.
 */
export function socialPostComposerIssue(
  provider: SocialPostProvider,
  text: string,
  media: readonly SocialPostMediaRef[],
): SocialPostComposerIssue | null {
  const hasText = text.trim().length > 0;
  if (SOCIAL_POST_TEXT_REQUIRED[provider] && !hasText) {
    return "text_required";
  }
  const requirement = SOCIAL_POST_MEDIA_REQUIREMENTS[provider];
  if (requirement === "none" && !hasText && media.length === 0) {
    return "text_or_media_required";
  }
  if (requirement === "any" && media.length === 0) return "media_required";
  if (
    requirement === "video" &&
    (media.length !== 1 || media[0]?.kind !== "video")
  ) {
    return "video_required";
  }
  const validation = validateSocialPostMedia(provider, media);
  return validation.ok ? null : validation.reason;
}

/**
 * The providers the composer validates against: the selected connections win,
 * because Core re-derives the provider from each connection on save and
 * schedule; a post without a selected connection keeps its own provider, and
 * a new post with none falls back to X. Never empty, never repeated.
 */
export function socialPostComposerProviders(
  postProvider: SocialPostProvider | null | undefined,
  selectedConnectionProviders: readonly SocialPostProvider[],
): [SocialPostProvider, ...SocialPostProvider[]] {
  const [first, ...rest] = [...new Set(selectedConnectionProviders)];
  return first ? [first, ...rest] : [postProvider ?? "x"];
}

/**
 * The file picker's accept list: only types every selected provider takes,
 * since one set of media goes to all of them.
 */
export function socialPostComposerAccept(
  providers: readonly SocialPostProvider[],
): string {
  const typesOf = (provider: SocialPostProvider) => {
    const rules = SOCIAL_POST_MEDIA_RULES[provider];
    return [
      ...rules.imageMimeTypes,
      ...rules.gifMimeTypes,
      ...rules.videoMimeTypes,
    ];
  };
  const [first, ...rest] = providers;
  if (!first) return "";
  return typesOf(first)
    .filter((type) =>
      rest.every((provider) =>
        (typesOf(provider) as readonly string[]).includes(type),
      ),
    )
    .join(",");
}
