import { describe, expect, it } from "vitest";

import {
  contentDispositionFor,
  contentSecurityPolicyFor,
  entityTagFor,
  isInlineRenderable,
} from "./file-content.service";

describe("isInlineRenderable", () => {
  it.each([
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ])("renders %s in place", (type) => {
    expect(isInlineRenderable(type)).toBe(true);
  });

  it("ignores parameters and case on the way in", () => {
    expect(isInlineRenderable("TEXT/Markdown; charset=utf-8")).toBe(true);
  });

  it.each([
    // The two that matter: a stored page or vector image rendered inline on
    // our own origin would run as a same-origin document.
    "text/html",
    "image/svg+xml",
    "application/xhtml+xml",
    "application/javascript",
    "application/octet-stream",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ])("refuses to render %s in place", (type) => {
    expect(isInlineRenderable(type)).toBe(false);
  });

  it("refuses an absent type rather than guessing", () => {
    expect(isInlineRenderable(null)).toBe(false);
  });
});

describe("contentDispositionFor", () => {
  /**
   * `filename*` has to be valid pct-encoding or the browser discards the
   * parameter and falls back to the ASCII `filename`, which for a
   * non-Latin name is a row of underscores.
   *
   * The budget was applied by slicing the *encoded* string, which cuts
   * inside a `%XX` escape. An ordinary 94-character Japanese filename was
   * enough: the value ended `…%8A%E6%9B` and `decodeURIComponent` threw.
   */
  it.each([
    ["an ordinary Japanese filename", `${"報告書".repeat(30)}.pdf`],
    ["a long name ending in a multi-byte character", `${"a".repeat(239)}€.pdf`],
    ["an astral character", `${"x".repeat(200)}${"\u{1F4C4}".repeat(20)}.pdf`],
    ["a plain short name", "notes.md"],
  ])("emits a decodable filename* for %s", (_label, name) => {
    const header = contentDispositionFor(name, false);
    const encoded = header.split("filename*=UTF-8''")[1];

    expect(encoded).toBeDefined();
    // The property that matters: a browser can decode it at all.
    expect(() => decodeURIComponent(encoded)).not.toThrow();
    // And what it decodes to is a prefix of the real name, not mojibake.
    expect(name.startsWith(decodeURIComponent(encoded))).toBe(true);
    expect(encoded.length).toBeLessThanOrEqual(240);
  });

  it("offers a renderable file inline and everything else as an attachment", () => {
    expect(contentDispositionFor("notes.md", true)).toContain("inline;");
    expect(contentDispositionFor("notes.md", false)).toContain("attachment;");
  });

  it("keeps an ordinary name readable and repeats it encoded", () => {
    expect(contentDispositionFor("quarterly report.pdf", true)).toBe(
      `inline; filename="quarterly report.pdf"; filename*=UTF-8''quarterly%20report.pdf`,
    );
  });

  it("drops the characters that would break out of the header", () => {
    const value = contentDispositionFor('ev"il\r\nX-Injected: 1.txt', true);

    // The injection needs a line break to start a second header, and a quote
    // to end the filename early. Neither survives. The remaining text is
    // inert: it is just an odd filename inside one quoted value.
    expect(value).not.toContain("\r");
    expect(value).not.toContain("\n");
    expect(value).toBe(
      `inline; filename="evilX-Injected: 1.txt"; filename*=UTF-8''${encodeURIComponent('ev"il\r\nX-Injected: 1.txt')}`,
    );

    // One opening and one closing quote around the plain filename, so nothing
    // after it can be read as a new parameter.
    expect(value.split('"')).toHaveLength(3);
  });

  it("drops a backslash rather than escaping it", () => {
    expect(contentDispositionFor("a\\b.txt", true)).toContain(
      'filename="ab.txt"',
    );
  });

  it("transliterates non-ASCII for the plain form and keeps it in the encoded one", () => {
    const value = contentDispositionFor("繰越.txt", true);

    expect(value).toContain('filename="__.txt"');
    expect(value).toContain(encodeURIComponent("繰越.txt"));
  });

  it("never emits an empty plain filename", () => {
    // Built rather than written as escapes: the formatter rewrites literal
    // control-character escapes in source, so writing them here would leave
    // raw control bytes in the file. A name of only control characters
    // strips to nothing, and nothing is not a filename.
    const controlOnly = String.fromCharCode(1, 2, 31, 127);

    expect(contentDispositionFor(controlOnly, true)).toContain(
      'filename="file"',
    );
    expect(contentDispositionFor("", true)).toContain('filename="file"');
  });
});

describe("contentSecurityPolicyFor", () => {
  it.each([
    "text/markdown",
    "text/html",
    "image/svg+xml",
    "application/octet-stream",
    // PDF included: the relaxation it once had is gone, because it never
    // made the sandboxed frame render.
    "application/pdf",
    "application/pdf; charset=binary",
  ])("gives %s an opaque origin and nothing else", (type) => {
    expect(contentSecurityPolicyFor(type)).toBe("sandbox; default-src 'none'");
  });

  it("never grants scripting or a same origin to served bytes", () => {
    for (const type of ["application/pdf", "text/html", "text/markdown"]) {
      const policy = contentSecurityPolicyFor(type);
      expect(policy).not.toContain("allow-scripts");
      expect(policy).not.toContain("allow-same-origin");
    }
  });
});

describe("entityTagFor", () => {
  it("changes when a re-upload changes the bytes", () => {
    // A re-upload to the same pathname keeps the object key and bumps
    // `contentRevision`. The old tag was the object key, so it did not move
    // — a validator that cannot invalidate. Nothing serves a 304 today, but
    // the first person to add conditional requests would have shipped a
    // cache that shows the previous document forever.
    const before = entityTagFor({ resourceId: "res-1", contentRevision: 1 });
    const after = entityTagFor({ resourceId: "res-1", contentRevision: 2 });

    expect(before).not.toBe(after);
  });

  it("is stable for the same revision", () => {
    // It still has to be a usable validator: same bytes, same tag.
    expect(entityTagFor({ resourceId: "res-1", contentRevision: 3 })).toBe(
      entityTagFor({ resourceId: "res-1", contentRevision: 3 }),
    );
  });

  it("never carries the storage coordinate", () => {
    // The web proxy forwards this header verbatim, and the blob store is
    // public with `addRandomSuffix: false`, so the pathname is the public
    // URL's path. This module claims the object key never leaves the
    // server; the ETag used to be exactly that key.
    const tag = entityTagFor({ resourceId: "res-1", contentRevision: 1 });

    expect(tag).not.toContain("drive/");
    expect(tag).not.toContain("/");
  });
});
