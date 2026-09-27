import { describe, expect, it } from "vitest";

import {
  contentDispositionFor,
  contentSecurityPolicyFor,
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
