import { isFileLikeUrl } from "./file-url.js";
import {
  findMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "./markdown-links.js";

export interface ExtractedLink {
  url: string;
  text?: string;
}

const AUTO_LINKS = /<((?:https?:)\/\/[^>\s]+)>/gi;

/**
 * Extracts markdown-style links [text](url) and autolinks <http://...> from markdown.
 */
export function extractLinks(markdown: string): ExtractedLink[] {
  const results: ExtractedLink[] = [];

  for (const { text, rawUrl } of findMarkdownLinks(markdown)) {
    results.push({ url: unescapeMarkdownLinkUrl(rawUrl), text });
  }
  for (const match of markdown.matchAll(AUTO_LINKS)) {
    const [, url] = match;
    results.push({ url });
  }

  return results;
}

export function extractFileLikeLinks(markdown: string): string[] {
  const links = extractLinks(markdown);
  const fileLinks = new Set<string>();
  for (const l of links) {
    if (isFileLikeUrl(l.url)) {
      fileLinks.add(l.url);
    }
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
      // ignore malformed URLs
    }
  }
  return Array.from(http);
}
