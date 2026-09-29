import { isFileLikeUrl } from "./file-url.js";
import {
  findMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "./markdown-links.js";
import {
  collectMarkdownUrlExcludedRanges,
  findBareHttpUrlHits,
  findHttpAutolinks,
} from "./markdown-url-scan.js";

export interface ExtractedLink {
  url: string;
  text?: string;
}

/**
 * Extracts markdown-style links [text](url) and autolinks <http://...> from markdown.
 */
export function extractLinks(markdown: string): ExtractedLink[] {
  const results: ExtractedLink[] = [];

  for (const { text, rawUrl } of findMarkdownLinks(markdown)) {
    results.push({ url: unescapeMarkdownLinkUrl(rawUrl), text });
  }
  for (const { url } of findHttpAutolinks(markdown)) {
    results.push({ url });
  }

  return results;
}

export function extractFileLikeLinks(
  markdown: string,
  options?: { excludeLinkLabels?: ReadonlySet<string> },
): string[] {
  const fileLinks = new Set<string>();
  const excludedUrls = new Set<string>();
  const excludeLabels = options?.excludeLinkLabels;

  const links = extractLinks(markdown);
  for (const l of links) {
    if (excludeLabels && l.text && excludeLabels.has(l.text)) {
      excludedUrls.add(l.url);
      continue;
    }
    if (isFileLikeUrl(l.url)) {
      fileLinks.add(l.url);
    }
  }

  const excludedRanges = collectMarkdownUrlExcludedRanges(markdown);
  for (const { url } of findBareHttpUrlHits(markdown, excludedRanges)) {
    if (excludedUrls.has(url)) {
      continue;
    }
    if (isFileLikeUrl(url)) {
      fileLinks.add(url);
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
