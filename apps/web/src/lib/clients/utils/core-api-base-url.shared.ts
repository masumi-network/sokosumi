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

export function normalizeCoreAuthBaseUrl(baseUrl: string): string {
  const withoutTrailingSlash = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");

  return withoutTrailingSlash.endsWith("/auth")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/auth`;
}

export function normalizeCoreApiBaseUrl(baseUrl: string): string {
  const withoutTrailingSlash = baseUrl.replace(/\/+$/, "");

  return withoutTrailingSlash.endsWith("/v1")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/v1`;
}

/**
 * Joins a Core API base URL to a path the same way the generated OpenAPI
 * client does: strip trailing slashes from the base, ensure the path starts
 * with a single `/`, then concatenate (avoids `//` when env values vary).
 */
export function joinCoreApiPath(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
