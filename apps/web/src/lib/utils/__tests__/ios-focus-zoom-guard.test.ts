import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ROOM_COMPOSER_TEXTAREA_CLASSNAME } from "@/components/chat/room-message-composer";
import { EDITABLE_TEXT_SIZE_CLASSNAME } from "@/lib/utils/editable-text-size";

/**
 * iOS Safari auto-zooms focused controls when computed font-size < 16px unless
 * page scale is locked. Product choice: viewport maximumScale 1 (no pinch),
 * pure rem editables (no 16px font floor).
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
    "%s declares maximumScale: 1 on the viewport export",
    (rel) => {
      const content = readFileSync(path.join(SRC_ROOT, rel), "utf8");
      expect(content).toMatch(/maximumScale:\s*1\b/);
      expect(content).toMatch(/export const viewport/);
    },
  );

  it("editables stay pure rem text-base (no px floor)", () => {
    expect(EDITABLE_TEXT_SIZE_CLASSNAME).toBe("text-base");
    expect(EDITABLE_TEXT_SIZE_CLASSNAME).not.toMatch(/16px/);
    expect(ROOM_COMPOSER_TEXTAREA_CLASSNAME).toContain("text-base");
  });
});
