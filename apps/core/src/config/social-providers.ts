import type { Prisma } from "@sokosumi/database";
import {
  SOCIAL_BETA_ORGANIZATION_SLUG,
  type SocialProviderWorkspace,
  socialProviderUnavailableMessage,
} from "@sokosumi/utils";
import { badRequest } from "@/helpers/error";
import { EVAL_ORGANIZATION_SLUG } from "@/lib/evals/eval-social-account";

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

const UTXO_MAINNET_WORKSPACE_ID = "03d70dc0-f302-45d5-a161-86beb31d2448";

/**
 * TikTok is open to every workspace through Zernio's audited TikTok app
 * (#7451), wherever Core holds a Zernio key. `workspaceId` keeps call sites
 * stable.
 */
export function socialProviderWorkspace(
  organizationSlug: string | null,
  _workspaceId: string,
): SocialProviderWorkspace {
  return {
    organizationSlug,
    // An eval lane posts to a stand-in TikTok account, Zernio key or not.
    tiktokEnabled:
      Boolean(process.env.ZERNIO_API_KEY?.trim()) ||
      EVAL_ORGANIZATION_SLUG.test(organizationSlug ?? ""),
  };
}

/**
/** utxo AG's mainnet workspace, where a network opens before everyone gets it. */
function isSocialBetaProject(project: SocialProviderProject): boolean {
  return (
    process.env.NETWORK === "Mainnet" &&
    project.workspace.organization?.slug === SOCIAL_BETA_ORGANIZATION_SLUG &&
    project.workspace.id === UTXO_MAINNET_WORKSPACE_ID
  );
}

/**
 * Our own TikTok app (the Composio path) has not passed TikTok's audit, so it
 * stays where it was allowed before (#7443): utxo's mainnet workspace. Every
 * other TikTok connection is a Zernio one.
 */
export function requireOwnTikTokAppAllowed(
  project: SocialProviderProject,
): void {
  if (!isSocialBetaProject(project)) {
    throw badRequest(
      "This TikTok connection is no longer supported. Connect the account again.",
    );
  }
}

/** Always resolve availability from the owning Project, never the actor's memberships. */
export const socialProviderProjectSelect = {
  workspace: {
    select: {
      organization: { select: { slug: true } },
      id: true,
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
    project.workspace.id,
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
