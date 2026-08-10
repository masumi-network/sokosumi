import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ROOM_COMPOSER_TEXTAREA_CLASSNAME } from "@/components/chat/room-message-composer";
import { EDITABLE_TEXT_SIZE_CLASSNAME } from "@/lib/utils/editable-text-size";

/**
 * iOS Safari auto-zooms focused controls when computed font-size < 16px unless
 * page scale is locked. Product choice: viewport maximumScale 1 (no pinch),
 * pure rem editables `text-base md:text-sm` (no 16px font floor).
 */

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const VIEWPORT_LAYOUTS = [
  "app/layout.tsx",
  "app/(app)/chat/layout.tsx",
] as const;

describe("iOS focus-zoom guard", () => {
  it.each(VIEWPORT_LAYOUTS)(
    "%s declares maximumScale: 1 on the viewport object (not only in comments)",
    (rel) => {
      const content = readFileSync(path.join(SRC_ROOT, rel), "utf8");
      const block = content.match(
        /export const viewport:\s*Viewport\s*=\s*\{([\s\S]*?)\n\};/,
      );
      expect(block, `missing viewport export object in ${rel}`).not.toBeNull();
      // Require the property on the object body so a leftover JSDoc mention
      // cannot keep this green after the real field is removed.
      expect(block?.[1]).toMatch(/maximumScale:\s*1\b/);
    },
  );

  it("editables use text-base md:text-sm (no px floor)", () => {
    expect(EDITABLE_TEXT_SIZE_CLASSNAME).toBe("text-base md:text-sm");
    expect(EDITABLE_TEXT_SIZE_CLASSNAME).not.toMatch(/16px/);
    expect(ROOM_COMPOSER_TEXTAREA_CLASSNAME).toContain("text-base");
    expect(ROOM_COMPOSER_TEXTAREA_CLASSNAME).toContain("md:text-sm");
  });
});
