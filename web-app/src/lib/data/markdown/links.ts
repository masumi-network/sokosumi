import { isFileLikeUrl } from "@/lib/utils/file";

export interface ExtractedLink {
  url: string;
  text?: string;
}

// Very small markdown link extractor; good enough for our use-case.
// Matches [text](url) and bare autolinks <http://...>
export function extractLinks(markdown: string): ExtractedLink[] {
  const results: ExtractedLink[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g; // [text](url "title")
  const autoRegex = /<((?:https?:)\/\/[^>\s]+)>/gi; // <http://...>

  for (const match of markdown.matchAll(linkRegex)) {
    const [, text, url] = match;
    results.push({ url, text });
  }
  for (const match of markdown.matchAll(autoRegex)) {
    const [, url] = match;
    results.push({ url });
  }

  return results;
}

export function extractFileLikeLinks(markdown: string): string[] {
  const links = extractLinks(markdown);
  const fileLinks = new Set<string>();
  for (const l of links) {
    if (isFileLikeUrl(l.url)) fileLinks.add(l.url);
  }
  return Array.from(fileLinks);
}

export function extractHttpLinks(markdown: string): string[] {
  const links = extractLinks(markdown);
  const http = new Set<string>();
  for (const l of links) {
    try {
      const u = new URL(l.url);
      if (
        (u.protocol === "http:" || u.protocol === "https:") &&
        !isFileLikeUrl(l.url)
      ) {
        http.add(l.url);
      }
    } catch {
      // ignore
    }
  }
  return Array.from(http);
}
