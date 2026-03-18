import * as Sentry from "@sentry/node";
import {
  blobRepository,
  linkRepository,
} from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";

function createMarkdownLinkRegex(): RegExp {
  return /\[([^\]\n]+)\]\(((?:\\\)|[^)\s])+)(?:\s+"[^"]*")?\)/g;
}

function unescapeMarkdownLinkUrl(url: string): string {
  return url.replace(/\\\)/g, ")");
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function getExtensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").pop() ?? "";
    const parts = last.split(".");
    return parts.length > 1 ? (parts.pop() as string).toLowerCase() : "";
  } catch {
    const last = url.split("/").pop() ?? "";
    const parts = last.split(".");
    return parts.length > 1 ? (parts.pop() as string).toLowerCase() : "";
  }
}

const FILE_EXTENSION_ALLOWLIST = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "svg",
  "gif",
  "pdf",
  "txt",
  "md",
  "rtf",
  "csv",
  "json",
  "xml",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "zip",
  "tar",
  "gz",
  "mp3",
  "mp4",
  "wav",
  "mov",
]);

function isFileLikeUrl(url: string): boolean {
  if (!isHttpUrl(url)) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return false;
    }
    if (parsedUrl.hash) {
      return false;
    }
    const extension = getExtensionFromUrl(url);
    if (!extension) {
      return false;
    }
    return FILE_EXTENSION_ALLOWLIST.has(extension);
  } catch {
    return false;
  }
}

function extractLinks(markdown: string): { text?: string; url: string }[] {
  const markdownLinks = createMarkdownLinkRegex();
  const autoLinks = /<((?:https?:)\/\/[^>\s]+)>/gi;
  const links: { text?: string; url: string }[] = [];

  for (const match of markdown.matchAll(markdownLinks)) {
    const [, text, rawUrl] = match;
    links.push({
      text,
      url: unescapeMarkdownLinkUrl(rawUrl),
    });
  }

  for (const match of markdown.matchAll(autoLinks)) {
    const [, url] = match;
    links.push({ url });
  }

  return links;
}

function extractFileLikeLinks(markdown: string): string[] {
  const links = extractLinks(markdown);
  const fileLinks = new Set<string>();

  for (const link of links) {
    if (isFileLikeUrl(link.url)) {
      fileLinks.add(link.url);
    }
  }

  return Array.from(fileLinks);
}

function extractHttpLinks(markdown: string): string[] {
  const links = extractLinks(markdown);
  const httpLinks = new Set<string>();

  for (const link of links) {
    try {
      const url = new URL(link.url);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !isFileLikeUrl(link.url)
      ) {
        httpLinks.add(link.url);
      }
    } catch {
      // Ignore malformed URLs.
    }
  }

  return Array.from(httpLinks);
}

function getBasename(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const pathnameTail = parsedUrl.pathname.split("/").pop() ?? "";
    return pathnameTail || null;
  } catch {
    return null;
  }
}

export const sourceImportService = {
  async enqueueFromMarkdown(
    _userId: string,
    jobEventId: string,
    markdown: string,
  ): Promise<void> {
    const fileLinks = extractFileLikeLinks(markdown);
    const httpLinks = extractHttpLinks(markdown);

    if (fileLinks.length === 0 && httpLinks.length === 0) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const url of fileLinks) {
        if (!isHttpUrl(url)) {
          continue;
        }

        try {
          await blobRepository.upsertOutputBlob(
            {
              eventId: jobEventId,
              sourceUrl: url,
              name: getBasename(url) ?? undefined,
            },
            tx,
          );
        } catch (error) {
          Sentry.captureException(error);
        }
      }

      for (const url of httpLinks) {
        if (!isHttpUrl(url)) {
          continue;
        }

        try {
          await linkRepository.upsertLink(
            {
              eventId: jobEventId,
              url,
              title: undefined,
            },
            tx,
          );
        } catch (error) {
          Sentry.captureException(error);
        }
      }
    });
  },
};
