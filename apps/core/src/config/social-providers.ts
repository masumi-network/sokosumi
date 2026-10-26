import { socialProviderUnavailableMessage } from "@sokosumi/utils";
import { badRequest } from "@/helpers/error";

export const PROJECT_SOCIAL_PROVIDERS = {
  x: {
    name: "X",
    toolkitSlug: "twitter",
    authConfigEnv: "COMPOSIO_X_AUTH_CONFIG_ID",
  },
  tiktok: {
    name: "TikTok",
    toolkitSlug: "tiktok",
    authConfigEnv: "COMPOSIO_TIKTOK_AUTH_CONFIG_ID",
  },
  instagram: {
    name: "Instagram",
    toolkitSlug: "instagram",
    authConfigEnv: "COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID",
  },
  linkedin: {
    name: "LinkedIn",
    toolkitSlug: "linkedin",
    authConfigEnv: "COMPOSIO_LINKEDIN_AUTH_CONFIG_ID",
  },
  facebook: {
    name: "Facebook",
    toolkitSlug: "facebook",
    authConfigEnv: "COMPOSIO_FACEBOOK_AUTH_CONFIG_ID",
  },
  youtube: {
    name: "YouTube",
    toolkitSlug: "youtube",
    authConfigEnv: "COMPOSIO_YOUTUBE_AUTH_CONFIG_ID",
  },
} as const;

export type ProjectSocialProvider = keyof typeof PROJECT_SOCIAL_PROVIDERS;

export function isProjectSocialProvider(
  provider: string,
): provider is ProjectSocialProvider {
  return Object.hasOwn(PROJECT_SOCIAL_PROVIDERS, provider);
}

/** Shared by connection flows and post mutations before any external effect. */
export function requireSocialProviderEnabled(provider: string): void {
  if (!isProjectSocialProvider(provider)) {
    throw badRequest(`Unsupported social provider: ${provider}`);
  }
  const message = socialProviderUnavailableMessage(provider);
  if (message) throw badRequest(message);
}
