import { describe, expect, it } from "vitest";

import {
  githubRawFileUrl,
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
const RAW_FILE =
  "https://raw.githubusercontent.com/masumi-network/sokosumi/84d0a395284dd5dda58367470411a1e611c2c997/docs/image-studio/deployment.md";

describe("githubRawFileUrl", () => {
  it("rewrites the blob page from the report to its raw file", () => {
    expect(githubRawFileUrl(BLOB_PAGE)).toBe(RAW_FILE);
  });

  it("rewrites a branch blob URL", () => {
    expect(
      githubRawFileUrl("https://github.com/owner/repo/blob/main/README.md"),
    ).toBe("https://raw.githubusercontent.com/owner/repo/main/README.md");
  });

  it("keeps a slashed branch name intact, as GitHub resolves it", () => {
    expect(
      githubRawFileUrl(
        "https://github.com/owner/repo/blob/feature/new-docs/docs/a.md",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/owner/repo/feature/new-docs/docs/a.md",
    );
  });

  it("normalizes the /raw/ route too, saving a redirect hop", () => {
    expect(
      githubRawFileUrl("https://github.com/owner/repo/raw/main/docs/a.md"),
    ).toBe("https://raw.githubusercontent.com/owner/repo/main/docs/a.md");
  });

  it("drops the page's own query and fragment", () => {
    expect(
      githubRawFileUrl(
        "https://github.com/owner/repo/blob/main/README.md?plain=1#L10",
      ),
    ).toBe("https://raw.githubusercontent.com/owner/repo/main/README.md");
  });

  it("accepts the www host", () => {
    expect(
      githubRawFileUrl("https://www.github.com/owner/repo/blob/main/a.md"),
    ).toBe("https://raw.githubusercontent.com/owner/repo/main/a.md");
  });

  it("leaves a raw URL alone — it is already the file", () => {
    expect(githubRawFileUrl(RAW_FILE)).toBeNull();
  });

  it("leaves a tree, release or repository page alone", () => {
    expect(
      githubRawFileUrl("https://github.com/owner/repo/tree/main/docs"),
    ).toBeNull();
    expect(githubRawFileUrl("https://github.com/owner/repo")).toBeNull();
    expect(
      githubRawFileUrl(
        "https://github.com/owner/repo/releases/download/v1/app.zip",
      ),
    ).toBeNull();
  });

  it("leaves a blob URL with no file path alone", () => {
    expect(
      githubRawFileUrl("https://github.com/owner/repo/blob/main"),
    ).toBeNull();
  });

  it("does not touch another host that happens to have /blob/", () => {
    expect(
      githubRawFileUrl("https://example.com/owner/repo/blob/main/a.md"),
    ).toBeNull();
  });

  it("returns null for a non-http scheme or a malformed URL", () => {
    expect(githubRawFileUrl("javascript:alert(1)")).toBeNull();
    expect(githubRawFileUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(githubRawFileUrl("not a url")).toBeNull();
  });
});

describe("resolveDownloadableFileUrl", () => {
  it("swaps a blob page for the raw file", () => {
    expect(resolveDownloadableFileUrl(BLOB_PAGE)).toBe(RAW_FILE);
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
        fileName: "deployment.md",
      }),
    ).toBe(true);
  });

  it("catches a login page arriving under a PDF name", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/html",
        fileName: "invoice.pdf",
      }),
    ).toBe(true);
  });

  it("allows an HTML file that is meant to be HTML", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/html",
        fileName: "report.html",
      }),
    ).toBe(false);
  });

  it("allows the matching content type for the name", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/markdown",
        fileName: "deployment.md",
      }),
    ).toBe(false);
    expect(
      isUnexpectedHtmlImport({
        contentType: "application/pdf",
        fileName: "invoice.pdf",
      }),
    ).toBe(false);
  });

  it("leaves an extensionless deliverable alone", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/html",
        fileName: "deliverable",
      }),
    ).toBe(false);
  });

  it("leaves an unknown extension alone rather than guessing", () => {
    expect(
      isUnexpectedHtmlImport({
        contentType: "text/html",
        fileName: "archive.weird",
      }),
    ).toBe(false);
  });

  it("does nothing when the response is not HTML", () => {
    expect(
      isUnexpectedHtmlImport({ contentType: null, fileName: "a.md" }),
    ).toBe(false);
  });
});
