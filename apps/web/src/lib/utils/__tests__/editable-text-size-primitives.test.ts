import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EDITABLE_TEXT_SIZE_CLASSNAME,
  withEditableTextSize,
} from "@/lib/utils/editable-text-size";

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const PRIMITIVE_SOURCES = [
  "components/ui/input.tsx",
  "components/ui/textarea.tsx",
  "components/ui/mention-textarea.tsx",
  "components/ui/command.tsx",
  "components/ui/select.tsx",
  "components/chat/room-message-composer.tsx",
  "app/(app)/tasks/components/markdown-editor.tsx",
  "app/(app)/personal-assistant/components/settings-panel.tsx",
] as const;

/** Callers must not set size — only the shared seam may. */
const CALLER_MD_SHRINK = /md:text-(?:sm|xs)\b/;
const PX_FLOOR = /max\(1rem,\s*16px\)/;

describe("editable text size primitives", () => {
  it("exports text-base with desktop md:text-sm and no px floor", () => {
    expect(EDITABLE_TEXT_SIZE_CLASSNAME).toBe("text-base md:text-sm");
    expect(EDITABLE_TEXT_SIZE_CLASSNAME).not.toMatch(PX_FLOOR);
  });

  it("keeps seam size last when callers pass text-sm or other sizes", () => {
    const merged = withEditableTextSize("p-4 text-sm", "text-xs");
    expect(merged).toContain("text-base");
    expect(merged).toContain("md:text-sm");
    expect(merged).toContain("p-4");
    expect(merged.split(/\s+/)).not.toContain("text-sm");
    expect(merged.split(/\s+/)).not.toContain("text-xs");
  });

  it.each(PRIMITIVE_SOURCES)(
    "%s uses withEditableTextSize and has no local md shrink or px floor",
    (rel) => {
      const content = readFileSync(path.join(SRC_ROOT, rel), "utf8");
      // Size comes from withEditableTextSize only — no local md:text-sm/xs.
      expect(content).not.toMatch(CALLER_MD_SHRINK);
      expect(content).not.toMatch(PX_FLOOR);
      expect(content).toMatch(/\bwithEditableTextSize\s*\(/);
    },
  );
});
