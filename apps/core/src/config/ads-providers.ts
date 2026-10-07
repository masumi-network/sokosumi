export const PROJECT_AD_PROVIDERS = {
  google_ads: {
    name: "Google Ads",
    toolkitSlug: "googleads",
    authConfigEnv: "COMPOSIO_GOOGLEADS_AUTH_CONFIG_ID",
  },
  meta_ads: {
    name: "Meta Ads",
    toolkitSlug: "metaads",
    authConfigEnv: "COMPOSIO_METAADS_AUTH_CONFIG_ID",
  },
} as const;

export type ProjectAdProvider = keyof typeof PROJECT_AD_PROVIDERS;

export function isProjectAdProvider(
  provider: string,
): provider is ProjectAdProvider {
  return Object.hasOwn(PROJECT_AD_PROVIDERS, provider);
}
