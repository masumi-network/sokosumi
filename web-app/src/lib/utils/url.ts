export function safeAddPathComponent(url: URL, pathComponent: string): URL {
  try {
    // Handle empty or whitespace-only path components
    const cleanPath = pathComponent.trim().replace(/^\/+|\/+$/g, "");

    if (!cleanPath) {
      return url; // Return original URL if nothing to add
    }

    // Preserve existing pathname and append new component
    const currentPath = url.pathname.replace(/\/+$/, ""); // Remove trailing slashes
    url.pathname = currentPath + "/" + encodeURIComponent(cleanPath);

    return url;
  } catch {
    throw new Error(`Invalid URL: ${url.href}`);
  }
}
