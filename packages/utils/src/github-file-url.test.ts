import { describe, expect, it } from "vitest";

import {
  githubBlobDownloadUrl,
  isHtmlContentType,
  isUnexpectedHtmlImport,
  resolveDownloadableFileUrl,
} from "./github-file-url.js";

/**
 * The reported bug: a GitHub blob page was imported under the name
 * `deployment.md`, so opening it showed GitHub's navigation menu and sign-in
 * link rendered as Markdown. These fixtures are synthetic — no network, and
 * no customer document.
 */
const BLOB_PAGE =
  "https://github.com/masumi-network/sokosumi/blob/84d0a395284dd5dda58367470411a1e611c2c997/docs/image-studio/deployment.md";
const DOWNLOAD_ROUTE =
  "https://github.com/masumi-network/sokosumi/raw/84d0a395284dd5dda58367470411a1e611c2c997/docs/image-studio/deployment.md";
const RAW_HOST_URL =
  "https://raw.githubusercontent.com/masumi-network/sokosumi/84d0a395284dd5dda58367470411a1e611c2c997/docs/image-studio/deployment.md";

describe("githubBlobDownloadUrl", () => {
  it("resolves the blob page from the report to GitHub's download route", () => {
    expect(githubBlobDownloadUrl(BLOB_PAGE)).toBe(DOWNLOAD_ROUTE);
  });

  it("resolves a branch blob URL", () => {
    expect(
      githubBlobDownloadUrl(
        "https://github.com/owner/repo/blob/main/README.md",
      ),
    ).toBe("https://github.com/owner/repo/raw/main/README.md");
  });

  it("keeps a slashed branch name intact, as GitHub resolves it", () => {
    expect(
      githubBlobDownloadUrl(
        "https://github.com/owner/repo/blob/feature/new-docs/docs/a.md",
      ),
    ).toBe("https://github.com/owner/repo/raw/feature/new-docs/docs/a.md");
  });

  it("drops the page's own query and fragment", () => {
    expect(
      githubBlobDownloadUrl(
        "https://github.com/owner/repo/blob/main/README.md?plain=1#L10",
      ),
    ).toBe("https://github.com/owner/repo/raw/main/README.md");
  });

  it("accepts the www host and normalizes to github.com", () => {
    expect(
      githubBlobDownloadUrl("https://www.github.com/owner/repo/blob/main/a.md"),
    ).toBe("https://github.com/owner/repo/raw/main/a.md");
  });

  it("leaves a raw.githubusercontent.com URL alone", () => {
    expect(githubBlobDownloadUrl(RAW_HOST_URL)).toBeNull();
  });

  it("leaves a tree, release or repository page alone", () => {
    expect(
      githubBlobDownloadUrl("https://github.com/owner/repo/tree/main/docs"),
    ).toBeNull();
    expect(githubBlobDownloadUrl("https://github.com/owner/repo")).toBeNull();
    expect(
      githubBlobDownloadUrl(
        "https://github.com/owner/repo/releases/download/v1/app.zip",
      ),
    ).toBeNull();
  });

  it("leaves a blob URL with no file path alone", () => {
    expect(
      githubBlobDownloadUrl("https://github.com/owner/repo/blob/main"),
    ).toBeNull();
  });

  it("does not touch another host that happens to have /blob/", () => {
    expect(
      githubBlobDownloadUrl("https://example.com/owner/repo/blob/main/a.md"),
    ).toBeNull();
  });

  it("returns null for a non-http scheme or a malformed URL", () => {
    expect(githubBlobDownloadUrl("javascript:alert(1)")).toBeNull();
    expect(githubBlobDownloadUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(githubBlobDownloadUrl("not a url")).toBeNull();
  });
});

/**
 * Git LFS is the reason the blob page resolves to GitHub's own `/raw/` route
 * rather than to `raw.githubusercontent.com`. For an LFS-tracked file the two
 * differ: `/raw/` redirects to `media.githubusercontent.com` and serves the
 * real bytes, while `raw.githubusercontent.com` serves the ~130 byte pointer
 * Git stores — with a 200 and `text/plain`, so nothing downstream notices.
 */
describe("Git LFS routing", () => {
  const LFS_RAW_ROUTE =
    "https://github.com/Schoonology/git-lfs-test/raw/master/binary.jpg";
  const LFS_BLOB_PAGE =
    "https://github.com/Schoonology/git-lfs-test/blob/master/binary.jpg";

  it("never rewrites an existing /raw/ link, which already reaches the media", () => {
    expect(githubBlobDownloadUrl(LFS_RAW_ROUTE)).toBeNull();
    expect(resolveDownloadableFileUrl(LFS_RAW_ROUTE)).toBe(LFS_RAW_ROUTE);
  });

  it("sends a blob page to the storage-aware route, not the pointer host", () => {
    const resolved = resolveDownloadableFileUrl(LFS_BLOB_PAGE);
    expect(resolved).toBe(LFS_RAW_ROUTE);
    expect(resolved).not.toContain("raw.githubusercontent.com");
  });

  it("never produces a raw.githubusercontent.com URL for any blob page", () => {
    for (const page of [BLOB_PAGE, LFS_BLOB_PAGE]) {
      expect(resolveDownloadableFileUrl(page)).not.toContain(
        "raw.githubusercontent.com",
      );
    }
  });
});

describe("resolveDownloadableFileUrl", () => {
  it("swaps a blob page for the download route", () => {
    expect(resolveDownloadableFileUrl(BLOB_PAGE)).toBe(DOWNLOAD_ROUTE);
  });

  it("passes an existing raw.githubusercontent.com URL through untouched", () => {
    expect(resolveDownloadableFileUrl(RAW_HOST_URL)).toBe(RAW_HOST_URL);
  });

  it("passes every other URL through untouched", () => {
    const blobStorage =
      "https://example.public.blob.vercel-storage.com/task/a/report.pdf";
    expect(resolveDownloadableFileUrl(blobStorage)).toBe(blobStorage);
    expect(resolveDownloadableFileUrl("not a url")).toBe("not a url");
  });
});

describe("isHtmlContentType", () => {
  it("recognizes HTML with and without parameters", () => {
    expect(isHtmlContentType("text/html")).toBe(true);
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("TEXT/HTML")).toBe(true);
    expect(isHtmlContentType("application/xhtml+xml")).toBe(true);
  });

  it("does not treat a document type as HTML", () => {
    expect(isHtmlContentType("text/markdown")).toBe(false);
    expect(isHtmlContentType("application/pdf")).toBe(false);
    expect(isHtmlContentType(null)).toBe(false);
    expect(isHtmlContentType(undefined)).toBe(false);
  });
});

describe("isUnexpectedHtmlImport", () => {
  it("catches a web page arriving under a Markdown name", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/html; charset=utf-8",
        fileNames: ["deployment.md"],
      }),
    ).toBe(true);
  });

  it("catches a login page arriving under a PDF name", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/html",
        fileNames: ["invoice.pdf"],
      }),
    ).toBe(true);
  });

  it("allows an HTML file that is meant to be HTML", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/html",
        fileNames: ["report.html"],
      }),
    ).toBe(false);
  });

  it("allows the matching content type for the name", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/markdown",
        fileNames: ["deployment.md"],
      }),
    ).toBe(false);
    expect(
      isUnexpectedHtmlImport({
        contentType: "application/pdf",
        fileNames: ["invoice.pdf"],
      }),
    ).toBe(false);
  });

  it("leaves an extensionless deliverable alone", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/html",
        fileNames: ["deliverable"],
      }),
    ).toBe(false);
  });

  it("leaves an unknown extension alone rather than guessing", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/html",
        fileNames: ["archive.weird"],
      }),
    ).toBe(false);
  });

  it("does nothing when the response is not HTML", () => {
    expect(
      isUnexpectedHtmlImport({ contentType: null, fileNames: ["a.md"] }),
    ).toBe(false);
  });

  /**
   * One of the candidate names comes from the response being judged. Taking
   * the first name and trusting it let a page clear itself by answering
   * `Content-Disposition: filename="login.html"`.
   */
  it("still rejects when the response renames itself to an HTML file", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/html",
        fileNames: ["login.html", "guide.md", "guide.md"],
      }),
    ).toBe(true);
  });

  it("rejects when only the source URL knows it should be a document", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/html",
        fileNames: [null, "guide.md", "login.html"],
      }),
    ).toBe(true);
  });

  it("tolerates null and undefined candidates", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/html",
        fileNames: [null, undefined],
      }),
    ).toBe(false);
  });
});
