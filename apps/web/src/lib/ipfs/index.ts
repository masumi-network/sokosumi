const IPFS_GATEWAY = "https://c-ipfs-gw.nmkr.io/ipfs/";

export const ipfsUrlResolver = (url: string): string => {
  const trimmed = url.trim();
  if (trimmed.startsWith("ipfs://")) {
    return trimmed.replace("ipfs://", IPFS_GATEWAY);
  }
  // Bare CID (v0: Qm..., v1: bafy...)
  if (trimmed.startsWith("Qm") || trimmed.startsWith("bafy")) {
    return IPFS_GATEWAY + trimmed;
  }
  return url;
};
