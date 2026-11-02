import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(
    process.cwd(),
    "src/app/(app)/personal-assistant/components/avatar-studio.client.tsx",
  ),
  "utf8",
);

const PREVIEW_COLUMN_REM = source.match(
  /export const AVATAR_STUDIO_PREVIEW_COLUMN_REM = (\d+)/,
)?.[1];

/**
 * The studio used to switch columns on viewport `lg` / `sm`, so a 243px
 * sidebar left the side panel too narrow. Layout now answers from the page
 * and the states panel via container queries. This locks the class strings —
 * jsdom cannot measure the geometry.
 */
describe("avatar studio layout", () => {
  it("exports one rem for the preview column width", () => {
    expect(PREVIEW_COLUMN_REM).toBe("35");
  });

  it("sizes the two-column break from the page container, not the viewport", () => {
    expect(source).toContain("@container flex w-full flex-col gap-8 py-2");
    expect(source).toContain(
      `@3xl:grid-cols-[minmax(0,${PREVIEW_COLUMN_REM}rem)_minmax(24rem,1fr)]`,
    );
    expect(source).not.toMatch(/\blg:grid-cols-/);
  });

  it("caps the preview column at the same width as the grid track", () => {
    expect(source).toContain(`max-w-[${PREVIEW_COLUMN_REM}rem]`);
    const track = source.match(
      /@3xl:grid-cols-\[minmax\(0,(\d+)rem\)_minmax\(24rem,1fr\)\]/,
    );
    const max = source.match(/max-w-\[(\d+)rem\]/);
    expect(track?.[1]).toBe(PREVIEW_COLUMN_REM);
    expect(max?.[1]).toBe(PREVIEW_COLUMN_REM);
  });

  it("sizes the state grid from the states panel, not the viewport", () => {
    expect(source).toContain("@container flex flex-col gap-4 p-4");
    expect(source).toContain("@md:grid-cols-6");
    expect(source).not.toMatch(/\bsm:grid-cols-6\b/);
  });

  it("lets the action row wrap when the side panel is tight", () => {
    expect(source).toContain("flex flex-wrap items-center gap-2");
  });
});
