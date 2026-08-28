import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  PROJECTS_BROWSE_LAYOUT_CLASS,
  PROJECTS_ITEM_LAYOUT_CLASS,
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_PAGE_SHELL_CLASS,
} from "@/app/projects/constants";

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

/**
 * Live list must share the same CLS footprint constants as the Instant skeleton
 * so reverting only projects-view / list-item cannot silently reintroduce swap jank.
 */
describe("projects list CLS layout pairing", () => {
  it("skeleton, live list, and empty state use PROJECTS_LIST_CARD_MIN_H_CLASS", () => {
    const loading = stripComments(
      readApp("projects/components/projects-loading-view.tsx"),
    );
    const view = stripComments(
      readApp("projects/components/projects-view.tsx"),
    );

    expect(loading).toMatch(/PROJECTS_LIST_CARD_MIN_H_CLASS/);
    expect(view).toMatch(/PROJECTS_LIST_CARD_MIN_H_CLASS/);
    // Empty + loaded list both reference the constant (two call sites).
    expect(
      view.match(/PROJECTS_LIST_CARD_MIN_H_CLASS/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(PROJECTS_LIST_CARD_MIN_H_CLASS).toBe("min-h-[320px]");
  });

  it("skeleton and live ProjectListItem use PROJECTS_ITEM_LAYOUT_CLASS", () => {
    const loading = stripComments(
      readApp("projects/components/projects-loading-view.tsx"),
    );
    const item = stripComments(
      readApp("projects/components/project-list-item.tsx"),
    );

    expect(loading).toMatch(/PROJECTS_ITEM_LAYOUT_CLASS/);
    expect(item).toMatch(/PROJECTS_ITEM_LAYOUT_CLASS/);
    expect(PROJECTS_ITEM_LAYOUT_CLASS).toContain(
      "[contain-intrinsic-size:auto_148px]",
    );
    expect(PROJECTS_ITEM_LAYOUT_CLASS).toContain(
      "md:[contain-intrinsic-size:auto_72px]",
    );
    expect(PROJECTS_ITEM_LAYOUT_CLASS).toContain("[content-visibility:auto]");
  });

  it("skeleton and live browse share PROJECTS_BROWSE_LAYOUT_CLASS", () => {
    const loading = stripComments(
      readApp("projects/components/projects-loading-view.tsx"),
    );
    const view = stripComments(
      readApp("projects/components/projects-view.tsx"),
    );

    expect(loading).toMatch(/PROJECTS_BROWSE_LAYOUT_CLASS/);
    expect(view).toMatch(/PROJECTS_BROWSE_LAYOUT_CLASS/);
    expect(PROJECTS_BROWSE_LAYOUT_CLASS).toContain("grid-cols-2");
    expect(PROJECTS_BROWSE_LAYOUT_CLASS).toContain("md:grid-cols-1");
  });

  it("page and Instant shell share PROJECTS_PAGE_SHELL_CLASS", () => {
    const page = stripComments(readApp("projects/(root)/page.tsx"));
    const loading = stripComments(
      readApp("projects/components/projects-loading-view.tsx"),
    );

    expect(page).toMatch(/PROJECTS_PAGE_SHELL_CLASS/);
    expect(loading).toMatch(/PROJECTS_PAGE_SHELL_CLASS/);
    expect(PROJECTS_PAGE_SHELL_CLASS).toContain("-mx-4");
    expect(PROJECTS_PAGE_SHELL_CLASS).toContain("px-2");
  });
});
