export const NEXT_IMAGE_REMOTE_PATTERNS = [
  {
    protocol: "https",
    hostname: "c-ipfs-gw.nmkr.io",
  },
  {
    protocol: "https",
    hostname: "yhpsw8jlcoagsrkq.public.blob.vercel-storage.com",
  },
  {
    protocol: "https",
    hostname: "igcd4cnfvuav1zto.public.blob.vercel-storage.com",
  },
  {
    protocol: "https",
    hostname: "**.azurecontainerapps.io",
  },
  {
    protocol: "https",
    hostname: "**.utxoag.com",
  },
] as const;

export function canUseNextImageSrc(url: string): boolean {
  if (url.startsWith("/")) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  const hostname = parsed.hostname;

  return NEXT_IMAGE_REMOTE_PATTERNS.some((pattern) => {
    if (pattern.protocol !== "https") {
      return false;
    }

    if (pattern.hostname.startsWith("**.")) {
      const suffix = pattern.hostname.slice(3);
      return hostname === suffix || hostname.endsWith(`.${suffix}`);
    }

    return hostname === pattern.hostname;
  });
}
