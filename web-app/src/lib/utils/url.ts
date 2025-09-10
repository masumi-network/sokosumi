export function safeAddPathComponent(url: URL, pathComponent: string): URL {
  try {
    // Handle empty or whitespace-only path components
    const cleanPath = pathComponent.trim().replace(/^\/+|\/+$/g, "");

    if (!cleanPath) {
      return new URL(url.href); // Return a new URL if nothing to add
    }

    // Preserve existing pathname and append new component
    const currentPath = url.pathname.replace(/\/+$/, ""); // Remove trailing slashes
    const newPath = currentPath + "/" + encodeURI(cleanPath);
    const newUrl = new URL(url.href);
    newUrl.pathname = newPath;

    return newUrl;
  } catch {
    throw new Error(`Invalid URL: ${url.href}`);
  }
}

export function getHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function buildFaviconCandidates(rawUrl: string): string[] {
  try {
    const u = new URL(rawUrl);
    const base = `${u.protocol}//${u.hostname}`;
    const host = u.hostname;
    return [
      `${base}/favicon.ico`,
      `${base}/favicon.png`,
      `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
      `https://icons.duckduckgo.com/ip3/${host}.ico`,
    ];
  } catch {
    return [];
  }
}
