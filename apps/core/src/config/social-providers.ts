import type { Prisma } from "@sokosumi/database";
import {
  type SocialProviderWorkspace,
  socialProviderUnavailableMessage,
} from "@sokosumi/utils";
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

/** The social provider that uses this Composio toolkit, if any. */
export function socialProviderForToolkit(toolkitSlug: string) {
  return Object.values(PROJECT_SOCIAL_PROVIDERS).find(
    (provider) => provider.toolkitSlug === toolkitSlug,
  );
}

/** Always resolve availability from the owning Project, never the actor's memberships. */
export const socialProviderProjectSelect = {
  workspace: { select: { organization: { select: { slug: true } } } },
} satisfies Prisma.ProjectSelect;

type SocialProviderProject = Prisma.ProjectGetPayload<{
  select: typeof socialProviderProjectSelect;
}>;

export function socialProviderWorkspaceForProject(
  project: SocialProviderProject,
): SocialProviderWorkspace {
  return { organizationSlug: project.workspace.organization?.slug ?? null };
}

/** Shared by connection flows and post mutations before any external effect. */
export function requireSocialProviderEnabled(
  provider: string,
  project: SocialProviderProject,
): void {
  if (!isProjectSocialProvider(provider)) {
    throw badRequest(`Unsupported social provider: ${provider}`);
  }
  const message = socialProviderUnavailableMessage(
    provider,
    socialProviderWorkspaceForProject(project),
  );
  if (message) throw badRequest(message);
}
