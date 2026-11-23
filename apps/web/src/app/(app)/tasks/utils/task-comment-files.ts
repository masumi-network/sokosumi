import type { TaskFile } from "@sokosumi/core-client";
import { BlobStatus } from "@sokosumi/core-client";
import { extractFileLikeLinks } from "@sokosumi/utils";
import type { BlobLike } from "@/components/sources/sources-grid";
import { getFileNameFromUrl } from "@/lib/utils/url";

/**
 * Match a comment file URL to a TaskFile. Prefers exact sourceUrl (keeps ?token=),
 * then fileUrl, then pathname basename === name (only when exactly one file matches).
 */
function matchTaskFile(
  url: string,
  taskFiles: TaskFile[],
): TaskFile | undefined {
  // Try exact sourceUrl match first
  for (const file of taskFiles) {
    if (file.sourceUrl === url) {
      return file;
    }
  }
  // Try fileUrl match
  for (const file of taskFiles) {
    if (file.fileUrl === url) {
      return file;
    }
  }
  // Try pathname basename match (only if unique)
  const urlBasename = url.split("/").pop()?.split("?")[0];
  if (urlBasename) {
    const basenameMatches: TaskFile[] = [];
    for (const file of taskFiles) {
      if (file.name === urlBasename) {
        basenameMatches.push(file);
      }
    }
    // Return basename match only when exactly one file matches
    if (basenameMatches.length === 1) {
      return basenameMatches[0];
    }
  }
  return undefined;
}

/** A character that continues a file name or a path: the name next to it is a part of a longer one. */
const NAME_PART_BEFORE = /[\w./-]/;
/** A word character, or a dot with one: "report.md" in "report.md.bak" is another file. A sentence's dot is none. */
const NAME_PART_AFTER = /^(?:[\w-]|\.\w)/;

/**
 * True when the text names the file as a whole word, as in "The Report is in the file report.pdf."
 * A name without an extension can be a common word, so it never counts.
 */
function namesFile(text: string, name: string): boolean {
  if (!name.includes(".")) return false;
  for (
    let at = text.indexOf(name);
    at !== -1;
    at = text.indexOf(name, at + 1)
  ) {
    const before = at === 0 ? "" : text[at - 1]!;
    const after = text.slice(at + name.length, at + name.length + 2);
    if (!NAME_PART_BEFORE.test(before) && !NAME_PART_AFTER.test(after))
      return true;
  }
  return false;
}

/**
 * The files a comment shows below its text: each file it links, then each Task file it names without a
 * link. A coworker that uploads its result names the file in plain text: Core imports each file a comment
 * links as a Task output, so the SEO worker writes no link.
 */
export function commentFiles(
  comment: string | null,
  taskFiles: TaskFile[],
): BlobLike[] {
  if (!comment) return [];
  const shown = new Set<string>();
  const linked = extractFileLikeLinks(comment).map((url, fileIndex) => {
    const matchedFile = matchTaskFile(url, taskFiles);
    if (matchedFile) {
      shown.add(matchedFile.id);
      return {
        id: `file-${fileIndex}`,
        sourceUrl: url,
        fileUrl: matchedFile.fileUrl,
        name: matchedFile.name,
        status: matchedFile.status,
        size: matchedFile.size,
        mimeType: matchedFile.mimeType,
      };
    }
    return {
      id: `file-${fileIndex}`,
      sourceUrl: url,
      fileUrl: url,
      name: getFileNameFromUrl(url),
      status: BlobStatus.READY,
      size: null,
      mimeType: null,
    };
  });
  const named = taskFiles
    .filter((file) => !shown.has(file.id) && namesFile(comment, file.name))
    .map((file) => ({
      id: `named-${file.id}`,
      sourceUrl: file.sourceUrl ?? file.fileUrl ?? "",
      fileUrl: file.fileUrl,
      name: file.name,
      status: file.status,
      size: file.size,
      mimeType: file.mimeType,
    }));
  return [...linked, ...named];
}
