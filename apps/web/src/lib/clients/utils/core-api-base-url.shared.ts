type CoreNetwork = "Mainnet" | "Preprod";

const LOCAL_CORE_APP_BASE_URL = "http://localhost:8787";
const PREVIEW_DOMAIN = "preview.sokosumi.com";

export function resolveCoreNetwork(value: string | undefined): CoreNetwork {
  return value === "Mainnet" ? "Mainnet" : "Preprod";
}

export function getCoreRelatedProjectName(network: CoreNetwork): string {
  return network === "Preprod"
    ? "sokosumi-core-preprod"
    : "sokosumi-core-mainnet";
}

export function getDefaultCoreApiBaseUrl(network: CoreNetwork): string {
  return network === "Preprod"
    ? "https://api.preprod.sokosumi.com"
    : "https://api.sokosumi.com";
}

function sanitizePreviewBranchSegment(value: string): string | undefined {
  let normalized = "";
  let previousWasSeparator = false;

  for (const character of value.toLowerCase()) {
    const isAlphaNumeric =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9");

    if (isAlphaNumeric) {
      normalized += character;
      previousWasSeparator = false;
      continue;
    }

    if (normalized === "" || previousWasSeparator) {
      continue;
    }

    normalized += "-";
    previousWasSeparator = true;
  }

  if (normalized.endsWith("-")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized || undefined;
}

export interface ResolveCoreRelatedProjectFallbackHostParams {
  configuredCoreAppBaseUrl?: string;
  network: CoreNetwork;
  vercelEnv?: string;
  vercelGitCommitRef?: string;
}

export function resolveCoreRelatedProjectFallbackHost(
  params: ResolveCoreRelatedProjectFallbackHostParams,
): string {
  if (params.vercelEnv === "preview") {
    const branchSegment = sanitizePreviewBranchSegment(
      params.vercelGitCommitRef ?? "",
    );

    if (branchSegment) {
      return `https://${getCoreRelatedProjectName(
        params.network,
      )}-git-${branchSegment}.${PREVIEW_DOMAIN}`;
    }

    return (
      params.configuredCoreAppBaseUrl ??
      getDefaultCoreApiBaseUrl(params.network)
    );
  }

  return params.configuredCoreAppBaseUrl ?? LOCAL_CORE_APP_BASE_URL;
}

export function normalizeCoreApiBaseUrl(baseUrl: string): string {
  const withoutTrailingSlash = baseUrl.replace(/\/+$/, "");

  return withoutTrailingSlash.endsWith("/v1")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/v1`;
}

export function stripCoreApiVersionSuffix(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
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
