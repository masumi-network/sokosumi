export type CoreNetwork = "Mainnet" | "Preprod";

export function getCoreRelatedProjectName(network: CoreNetwork): string {
  return network === "Preprod"
    ? "sokosumi-core-preprod"
    : "sokosumi-core-mainnet";
}

export function getDefaultCoreApiBaseUrl(network: CoreNetwork): string {
  return network === "Preprod"
    ? "https://preprod.api.sokosumi.com"
    : "https://api.sokosumi.com";
}

export function normalizeCoreApiBaseUrl(baseUrl: string): string {
  const withoutTrailingSlash = baseUrl.replace(/\/+$/, "");

  return withoutTrailingSlash.endsWith("/v1")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/v1`;
}
