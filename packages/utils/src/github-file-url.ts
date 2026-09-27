import { FILE_EXTENSION_ALLOWLIST, getExtensionFromUrl } from "./file-url.js";

/**
 * Telling a link to a file from a link to a page about a file.
 *
 * GitHub serves three different things for the same path. `/blob/<ref>/<path>`
 * is an HTML *page* about a file — navigation menu, sign-in link, the lot.
 * `/raw/<ref>/<path>` is the download route, which redirects to whichever host
 * actually holds the bytes. Both end in the file's own extension, so an
 * importer that decides by extension downloads the page and stores it under
 * the file's name.
 */

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
/** The page route. The only one that needs rewriting. */
const BLOB_ROUTE = "blob";

/**
 * The download route for a GitHub blob page, or null when this is not one.
 *
 * This deliberately resolves to GitHub's own `/raw/` route rather than
 * straight to `raw.githubusercontent.com`. The two are not content-equivalent:
 * for a Git LFS file, `/raw/` redirects to `media.githubusercontent.com` and
 * serves the real bytes, while `raw.githubusercontent.com` serves the ~130
 * byte LFS pointer that Git actually stores — with a 200 and a `text/plain`
 * type, so nothing downstream would notice. Letting GitHub route the request
 * keeps LFS and non-LFS files working through one rule.
 *
 * An existing `/raw/` URL is returned as null, meaning "already correct,
 * leave it alone" — rewriting it is what would break LFS.
 *
 * The ref is not separated from the path: a branch name may contain slashes,
 * and GitHub resolves `<ref>/<path>` with exactly the same ambiguity on both
 * routes, so passing the tail through unchanged keeps the two in agreement.
 */
export function githubBlobDownloadUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const parts = parsed.pathname.split("/").filter(Boolean);
  // owner / repo / blob / ref / at least one path segment
  if (parts.length < 5) return null;
  if (parts[2] !== BLOB_ROUTE) return null;

  const [owner, repo] = parts;
  const tail = parts.slice(3).join("/");

  // Query and fragment belong to the page (`?plain=1`, `#L10`), not the file.
  return `https://github.com/${owner}/${repo}/raw/${tail}`;
}

/**
 * The URL an importer should actually download. Anything that is not a
 * recognised page-about-a-file is returned unchanged, so this can sit in
 * front of a fetch without narrowing what is importable.
 */
export function resolveDownloadableFileUrl(url: string): string {
  return githubBlobDownloadUrl(url) ?? url;
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
 * True when a response is an HTML page but something we already know about
 * the file says it should be some other kind of document.
 *
 * This is the general form of the GitHub case: a login wall in front of a
 * PDF, a docs route ending in `.md`, a redirect to an error page. Storing the
 * HTML under the document's name produces a file that downloads and previews
 * as nonsense, so the import fails instead — a state the UI already has,
 * unlike "succeeded, but the contents are a web page".
 *
 * Every candidate name is considered, and any one of them contradicting the
 * response is enough. That matters because one of the candidates — the
 * response's own `Content-Disposition` filename — is supplied by the server
 * being checked. Taking the *first* name and trusting it let a page answer
 * `filename="login.html"` and excuse itself; ORing over the stored name and
 * the URL as well means the response can only ever make the check stricter.
 *
 * A name with no extension (an agent deliverable, say) contributes nothing:
 * there is nothing to contradict, and narrowing that would reject imports
 * that work today.
 */
export function isUnexpectedHtmlImport(input: {
  contentType: string | null | undefined;
  fileNames: readonly (string | null | undefined)[];
}): boolean {
  if (!isHtmlContentType(input.contentType)) return false;

  return input.fileNames.some((fileName) => {
    if (!fileName) return false;
    const extension = getExtensionFromUrl(fileName);
    if (!extension) return false;
    if (HTML_EXTENSIONS.has(extension)) return false;
    return FILE_EXTENSION_ALLOWLIST.has(extension);
  });
}
