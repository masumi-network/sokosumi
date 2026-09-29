import { err, ok, type Result } from "neverthrow";

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

export function safeAddPathComponent(
  url: URL,
  pathComponent: string,
): Result<URL, string> {
  try {
    const cleanPath = trimSlashes(pathComponent.trim());

    if (!cleanPath) {
      return ok(new URL(url.href));
    }

    const currentPath = trimSlashes(url.pathname);
    const newPath = `${currentPath}/${encodeURI(cleanPath)}`;
    const newUrl = new URL(url.href);
    newUrl.pathname = currentPath ? newPath : `/${encodeURI(cleanPath)}`;

    return ok(newUrl);
  } catch {
    return err(`Invalid URL: ${url.href}`);
  }
}
