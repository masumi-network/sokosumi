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

/** Missing content the Post now tooltip can name; media-type failures toast instead. */
export type SocialPostComposerRequirementIssue = Extract<
  SocialPostComposerIssue,
  | "text_required"
  | "text_or_media_required"
  | "media_required"
  | "video_required"
>;

function isRequirementIssue(
  issue: SocialPostComposerIssue | null,
): issue is SocialPostComposerRequirementIssue {
  return (
    issue === "text_required" ||
    issue === "text_or_media_required" ||
    issue === "media_required" ||
    issue === "video_required"
  );
}

/**
 * Composer-side view of the provider's publish rules. The server enforces
 * the same rules on schedule and publish. Drafts skip the media-presence
 * check — see {@link socialPostComposerDraftIssue}.
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
 * Instagram, TikTok, and YouTube drafts may omit media. Attached files
 * still have to be a type the network accepts, and a draft still needs
 * text or a file.
 */
export function socialPostComposerDraftIssue(
  provider: SocialPostProvider,
  text: string,
  media: readonly SocialPostMediaRef[],
): SocialPostComposerIssue | null {
  const issue = socialPostComposerIssue(provider, text, media);
  if (issue !== "media_required" && issue !== "video_required") {
    return issue;
  }
  const validation = validateSocialPostMedia(provider, media);
  if (!validation.ok) return validation.reason;
  return text.trim().length > 0 || media.length > 0 ? null : issue;
}

/**
 * One row per selected provider that still needs text or media. The same
 * "add text or media" line is not repeated when several networks share it.
 */
export function socialPostComposerRequirements(
  accounts: readonly { provider: SocialPostProvider; text: string }[],
  media: readonly SocialPostMediaRef[],
): {
  provider: SocialPostProvider;
  issue: SocialPostComposerRequirementIssue;
}[] {
  const seen = new Set<string>();
  const hints: {
    provider: SocialPostProvider;
    issue: SocialPostComposerRequirementIssue;
  }[] = [];
  for (const account of accounts) {
    const issue = socialPostComposerIssue(
      account.provider,
      account.text,
      media,
    );
    if (!isRequirementIssue(issue)) continue;
    const key =
      issue === "text_or_media_required"
        ? issue
        : `${issue}:${account.provider}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push({ provider: account.provider, issue });
  }
  return hints;
}

/**
 * The providers the composer validates against: the selected connections win,
 * because Core re-derives the provider from each connection on save and
 * schedule. With none selected, an existing post keeps its own provider.
 * Connected accounts set a new draft's limits, so deselecting everyone does
 * not switch it to X. A new post with no accounts falls back to X. Never
 * empty, never repeated.
 */
export function socialPostComposerProviders(
  postProvider: SocialPostProvider | null | undefined,
  selectedConnectionProviders: readonly SocialPostProvider[],
  availableConnectionProviders: readonly SocialPostProvider[] = [],
): [SocialPostProvider, ...SocialPostProvider[]] {
  const [first, ...rest] = [...new Set(selectedConnectionProviders)];
  if (first) return [first, ...rest];
  if (postProvider) return [postProvider];
  const [available, ...availableRest] = [
    ...new Set(availableConnectionProviders),
  ];
  if (available) return [available, ...availableRest];
  return ["x"];
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

/**
 * What a provider publishes a Sokosumi post as, from its media rule: a plain
 * post (text, optionally with media), a media post that needs an image or a
 * video, or a video whose text becomes its title and description.
 */
export type SocialPostComposerFormat = "post" | "mediaPost" | "video";

export function socialPostComposerFormat(
  provider: SocialPostProvider,
): SocialPostComposerFormat {
  const requirement = SOCIAL_POST_MEDIA_REQUIREMENTS[provider];
  if (requirement === "video") return "video";
  if (requirement === "any") return "mediaPost";
  return "post";
}
