import type { FeedItem } from "@/lib/services/feed.service";

export function getFirstMarkdownHeading(
  markdown: string | null,
): string | null {
  if (!markdown?.trim()) {
    return null;
  }

  const lines = markdown.trimStart().split("\n");
  const firstHeading = lines.find((line) => /^#{1,6}\s+/.test(line.trim()));
  if (!firstHeading) {
    return null;
  }

  return (
    firstHeading
      .trim()
      .replace(/^#{1,6}\s+/, "")
      .trim() || null
  );
}

export function removeFirstMarkdownHeading(
  markdown: string | null,
): string | null {
  if (!markdown?.trim()) {
    return markdown;
  }

  const lines = markdown.trimStart().split("\n");
  const headingIndex = lines.findIndex((line) =>
    /^#{1,6}\s+/.test(line.trim()),
  );
  if (headingIndex === -1) {
    return markdown;
  }

  const remaining = [
    ...lines.slice(0, headingIndex),
    ...lines.slice(headingIndex + 1),
  ]
    .join("\n")
    .trim();

  return remaining || null;
}

export function resolveTitle(
  item: FeedItem,
  untitledJob: string,
  untitledTask: string,
) {
  const trimmedTitle = item.title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  if (item.type === "job") {
    return untitledJob;
  }

  return untitledTask;
}
