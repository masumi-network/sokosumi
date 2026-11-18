import type { Prisma } from "@sokosumi/database";
import {
  SOCIAL_BETA_ORGANIZATION_SLUG,
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

export function socialProviderWorkspace(
  organizationSlug: string | null,
  owner?: { email: string; emailVerified: boolean } | null,
): SocialProviderWorkspace {
  const recordingPreview =
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === "feat/tiktok-sandbox-recording";
  const eligible =
    process.env.NETWORK === "Mainnet"
      ? organizationSlug === SOCIAL_BETA_ORGANIZATION_SLUG
      : process.env.NETWORK === "Preprod" &&
        organizationSlug === null &&
        owner?.emailVerified === true &&
        owner.email.toLowerCase() === "albina.nikiforova@nmkr.io";
  return { organizationSlug, tiktokSandbox: recordingPreview && eligible };
}

/** Always resolve availability from the owning Project, never the actor's memberships. */
export const socialProviderProjectSelect = {
  workspace: {
    select: {
      organization: { select: { slug: true } },
      user: { select: { email: true, emailVerified: true } },
    },
  },
} satisfies Prisma.ProjectSelect;

type SocialProviderProject = Prisma.ProjectGetPayload<{
  select: typeof socialProviderProjectSelect;
}>;

export function socialProviderWorkspaceForProject(
  project: SocialProviderProject,
): SocialProviderWorkspace {
  return socialProviderWorkspace(
    project.workspace.organization?.slug ?? null,
    project.workspace.user,
  );
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
