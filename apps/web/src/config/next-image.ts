export const NEXT_IMAGE_REMOTE_PATTERNS = [
  {
    protocol: "https",
    hostname: "c-ipfs-gw.nmkr.io",
  },
  /** Any Vercel Blob store id (*.public.blob.vercel-storage.com). */
  {
    protocol: "https",
    hostname: "*.public.blob.vercel-storage.com",
  },
  {
    protocol: "https",
    hostname: "**.azurecontainerapps.io",
  },
  {
    protocol: "https",
    hostname: "**.utxoag.com",
  },
  /**
   * Serviceplan coworker hosts (Jamal, Maya, …). `*` = one subdomain segment
   * (e.g. usecases. / foo.); apex listed separately because Next `*` does not
   * match the bare domain.
   */
  {
    protocol: "https",
    hostname: "*.serviceplan-agents.com",
  },
  {
    protocol: "https",
    hostname: "serviceplan-agents.com",
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

    if (pattern.hostname.startsWith("*.")) {
      const suffix = pattern.hostname.slice(2);
      // * means exactly one subdomain segment; bare domain (zero subdomains) must not match
      if (!hostname.endsWith(`.${suffix}`)) {
        return false;
      }
      const prefix = hostname.slice(0, -(suffix.length + 1));
      return prefix.length > 0 && !prefix.includes(".");
    }

    return hostname === pattern.hostname;
  });
}
