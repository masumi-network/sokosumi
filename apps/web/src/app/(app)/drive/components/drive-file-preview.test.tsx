import { describe, expect, it } from "vitest";

import {
  contentUrl,
  effectiveType,
  rendersAsMarkdown,
} from "./drive-file-preview";

/**
 * The two decisions this component makes before it renders anything: which
 * URL to read from, and what it believes the file is.
 */

describe("contentUrl", () => {
  it("reads through this origin, never a storage host", () => {
    const url = contentUrl({
      resourceId: "resource-1",
      store: { scope: "me" },
    });

    expect(url).toBe("/api/drive/files/resource-1/content?scope=me");
    expect(url).not.toContain("blob.vercel-storage.com");
    expect(url.startsWith("/")).toBe(true);
  });

  it("carries the organization for an org store", () => {
    expect(
      contentUrl({
        resourceId: "resource-1",
        store: { scope: "org", organizationId: "org-7" },
      }),
    ).toBe(
      "/api/drive/files/resource-1/content?scope=org&organizationId=org-7",
    );
  });

  it("asks for a download only when told to", () => {
    expect(
      contentUrl({
        resourceId: "resource-1",
        store: { scope: "me" },
        download: true,
      }),
    ).toContain("download=true");
  });
});

describe("effectiveType", () => {
  it("believes a recorded type", () => {
    expect(effectiveType("application/pdf", "whatever.md")).toBe(
      "application/pdf",
    );
  });

  it("ignores parameters and case", () => {
    expect(effectiveType("TEXT/Markdown; charset=utf-8", "a.md")).toBe(
      "text/markdown",
    );
  });

  it.each([
    ["notes.md", "text/markdown"],
    ["notes.MD", "text/markdown"],
    ["data.csv", "text/csv"],
    ["shape.json", "application/json"],
    ["report.pdf", "application/pdf"],
    ["photo.JPG", "image/jpeg"],
    ["diagram.png", "image/png"],
  ])(
    // The regression that prompted this: uploads arrive with a null mimeType,
    // and the first version reported "no preview" for every one of them.
    "falls back to the name for %s when the catalog recorded nothing",
    (name, expected) => {
      expect(effectiveType(null, name)).toBe(expected);
    },
  );

  it("treats octet-stream as not knowing, not as a decision", () => {
    expect(effectiveType("application/octet-stream", "notes.md")).toBe(
      "text/markdown",
    );
  });

  it("does not guess for an unknown extension or a bare name", () => {
    expect(effectiveType(null, "archive.xyz")).toBe("");
    expect(effectiveType(null, "README")).toBe("");
  });

  it("never guesses a type that would render as a document", () => {
    // A stored page or vector image must reach the attachment path, whatever
    // it is called.
    expect(effectiveType(null, "page.html")).toBe("");
    expect(effectiveType(null, "logo.svg")).toBe("");
  });
});

describe("rendersAsMarkdown", () => {
  it("renders Markdown and shows every other text type verbatim", () => {
    // A CSV or JSON file put through the Markdown renderer is not the
    // file. Pipes become tables, a leading `-` becomes a bullet, `#`
    // becomes a heading, `*` vanishes into emphasis, and a `---` row
    // becomes a rule — in a panel labelled "Preview", with nothing telling
    // the reader that what they see differs from the bytes.
    expect(rendersAsMarkdown("text/markdown")).toBe(true);

    for (const type of ["text/csv", "application/json", "text/plain"]) {
      expect(rendersAsMarkdown(type)).toBe(false);
    }
  });
});
