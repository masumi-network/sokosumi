export function getCoreRelatedProjectName(
  network: "Mainnet" | "Preprod",
): string {
  return network === "Preprod"
    ? "sokosumi-core-preprod"
    : "sokosumi-core-mainnet";
}

export function getDefaultCoreApiBaseUrl(
  network: "Mainnet" | "Preprod",
): string {
  return network === "Preprod"
    ? "https://api.preprod.sokosumi.com"
    : "https://api.sokosumi.com";
}

export function normalizeCoreApiBaseUrl(baseUrl: string): string {
  const withoutTrailingSlash = baseUrl.replace(/\/+$/, "");

  return withoutTrailingSlash.endsWith("/v1")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/v1`;
}
