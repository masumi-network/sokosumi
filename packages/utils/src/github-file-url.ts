import { FILE_EXTENSION_ALLOWLIST, getExtensionFromUrl } from "./file-url.js";

/**
 * Telling a link to a file from a link to a page about a file.
 *
 * GitHub serves two different things under two different hosts. A
 * `github.com/<owner>/<repo>/blob/<ref>/<path>` URL is an HTML *page* about a
 * file — navigation menu, sign-in link, the lot — while the file itself lives
 * on `raw.githubusercontent.com`. Both end in `.md`, so an importer that
 * decides by extension downloads the page and stores it under the file's
 * name. What the reader then opens is GitHub's chrome rendered as Markdown.
 */

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const GITHUB_RAW_HOST = "raw.githubusercontent.com";
/** `/blob/` is the page; `/raw/` already redirects to the raw host. */
const FILE_ROUTES = new Set(["blob", "raw"]);

/**
 * The raw file URL behind a GitHub blob page, or null when this is not one.
 *
 * The ref is not separated from the path: a branch name may contain slashes,
 * and `raw.githubusercontent.com` resolves `<ref>/<path>` with exactly the
 * same ambiguity GitHub itself does, so passing the tail through unchanged
 * keeps the two in agreement.
 */
export function githubRawFileUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const parts = parsed.pathname.split("/").filter(Boolean);
  // owner / repo / (blob|raw) / ref / at least one path segment
  if (parts.length < 5) return null;
  if (!FILE_ROUTES.has(parts[2])) return null;

  const [owner, repo] = parts;
  const tail = parts.slice(3).join("/");

  // Query and fragment belong to the page (`?plain=1`, `#L10`), not the file.
  return `https://${GITHUB_RAW_HOST}/${owner}/${repo}/${tail}`;
}

/**
 * The URL an importer should actually download. Anything that is not a
 * recognised page-about-a-file is returned unchanged, so this can sit in
 * front of a fetch without narrowing what is importable.
 */
export function resolveDownloadableFileUrl(url: string): string {
  return githubRawFileUrl(url) ?? url;
}

const HTML_MEDIA_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const HTML_EXTENSIONS = new Set(["html", "htm", "xhtml"]);

export function isHtmlContentType(
  contentType: string | null | undefined,
): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return HTML_MEDIA_TYPES.has(mediaType);
}

/**
 * True when a response is an HTML page but the thing we are importing is
 * named as some other kind of document.
 *
 * This is the general form of the GitHub case: a login wall in front of a
 * PDF, a docs route ending in `.md`, a redirect to an error page. Storing
 * the HTML under the document's name produces a file that downloads and
 * previews as nonsense, so the import fails instead — which is a state the
 * UI already has, unlike "succeeded, but the contents are a web page".
 *
 * A name with no extension (an agent deliverable, say) is left alone: there
 * is nothing to contradict, and narrowing that would reject imports that
 * work today.
 */
export function isUnexpectedHtmlImport(input: {
  contentType: string | null | undefined;
  fileName: string;
}): boolean {
  if (!isHtmlContentType(input.contentType)) return false;

  const extension = getExtensionFromUrl(input.fileName);
  if (!extension) return false;
  if (HTML_EXTENSIONS.has(extension)) return false;

  return FILE_EXTENSION_ALLOWLIST.has(extension);
}
