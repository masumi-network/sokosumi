import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

const DYNAMIC_SHELL_API_RE =
  /\b(?:cookies|headers|draftMode|connection|getTranslations|getFormatter|getLocale|getMessages|getSession)\s*\(/;

function readDrive(rel: string): string {
  return readFileSync(join(here, rel), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("drive Instant Nav skeleton contract", () => {
  it("drive/page.tsx awaits connection for cookie-bound view mode", () => {
    const source = readDrive("page.tsx");
    expect(source).toMatch(/\bawait\s+connection\s*\(/);
    expect(source).toMatch(/\bgetDefaultFilesViewMode\b/);
  });

  it("drive/loading.tsx stays sync (no cookies/connection/session/i18n)", () => {
    const code = stripComments(readDrive("loading.tsx"));
    expect(code).not.toMatch(DYNAMIC_SHELL_API_RE);
  });

  it("drive/loading.tsx default export returns DriveListSkeleton", () => {
    const code = stripComments(readDrive("loading.tsx"));
    expect(code).toMatch(
      /export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*<\s*DriveListSkeleton\s*\/>/,
    );
  });
});
