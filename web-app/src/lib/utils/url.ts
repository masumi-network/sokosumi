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
