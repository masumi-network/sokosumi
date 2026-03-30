function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && value[start] === "/") {
    start++;
  }

  while (end > start && value[end - 1] === "/") {
    end--;
  }

  return value.slice(start, end);
}

export function safeAddPathComponent(url: URL, pathComponent: string): URL {
  try {
    // Handle empty or whitespace-only path components
    const cleanPath = trimSlashes(pathComponent.trim());

    if (!cleanPath) {
      return new URL(url.href); // Return a new URL if nothing to add
    }

    // Preserve existing pathname and append new component
    const currentPath = trimSlashes(url.pathname);
    const newPath = `${currentPath}/${encodeURI(cleanPath)}`;
    const newUrl = new URL(url.href);
    newUrl.pathname = currentPath ? newPath : `/${encodeURI(cleanPath)}`;

    return newUrl;
  } catch {
    throw new Error(`Invalid URL: ${url.href}`);
  }
}
