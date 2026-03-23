/**
 * Default NMKR IPFS gateway prefix for resolving `ipfs://` and bare CIDs.
 */
export const IPFS_GATEWAY_PREFIX = "https://c-ipfs-gw.nmkr.io/ipfs/";

/**
 * Resolves `ipfs://`, bare IPFS CIDs (v0 `Qm…`, v1 `bafy…`), or returns the trimmed string.
 */
export function resolveIpfsOrHttpUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  if (trimmed.startsWith("ipfs://")) {
    return trimmed.replace("ipfs://", IPFS_GATEWAY_PREFIX);
  }
  if (trimmed.startsWith("Qm") || trimmed.startsWith("bafy")) {
    return IPFS_GATEWAY_PREFIX + trimmed;
  }
  return trimmed;
}

/**
 * Normalizes organization logo values for storage/API: trims, maps empty to `null`,
 * and resolves IPFS-style values to HTTPS gateway URLs.
 */
export function normalizeOrganizationLogo(
  logo: string | null | undefined,
): string | null {
  if (logo == null) {
    return null;
  }
  const trimmed = logo.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return resolveIpfsOrHttpUrl(trimmed);
}
