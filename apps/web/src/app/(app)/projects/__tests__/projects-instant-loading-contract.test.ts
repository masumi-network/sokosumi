import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "../..");

/** Dynamic APIs that must not appear in Instant loading shell *code*. */
const DYNAMIC_SHELL_API_RE =
  /\b(?:cookies|headers|draftMode|connection|getTranslations|getFormatter|getLocale|getMessages|getSession)\s*\(/;

function readApp(rel: string): string {
  return readFileSync(join(appDir, rel), "utf8");
}

/** Drop comments so "no connection()" docs do not false-positive the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Require default export's *only* body statement to be `return <SkeletonName />`.
 * Thin Instant loaders must not hide a different return behind helpers/branches.
 */
function assertDefaultReturnsSkeleton(
  source: string,
  skeletonName: string,
): void {
  const code = stripComments(source);
  const pattern = new RegExp(
    String.raw`export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{\s*return\s+<\s*${skeletonName}\s*\/>\s*;?\s*\}`,
  );
  expect(code).toMatch(pattern);
}

describe("projects Instant Nav skeleton contract", () => {
  it("projects/(root)/page.tsx does not soft-nav opt out of Instant", () => {
    const source = readApp("projects/(root)/page.tsx");
    expect(source).not.toMatch(/export\s+const\s+instant\s*=\s*false/);
  });

  it("projects/(root)/loading.tsx stays sync (no cookies/connection/session/i18n)", () => {
    const code = stripComments(readApp("projects/(root)/loading.tsx"));
    expect(code).not.toMatch(DYNAMIC_SHELL_API_RE);
  });

  it("projects/components/projects-loading-view.tsx stays sync", () => {
    const code = stripComments(
      readApp("projects/components/projects-loading-view.tsx"),
    );
    expect(code).not.toMatch(DYNAMIC_SHELL_API_RE);
  });

  it("projects/(root)/loading.tsx default export returns ProjectsPageSkeleton", () => {
    assertDefaultReturnsSkeleton(
      readApp("projects/(root)/loading.tsx"),
      "ProjectsPageSkeleton",
    );
  });
});
