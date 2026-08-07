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
] as const;

const MD_SHRINK = /md:text-(?:sm|xs)\b/;
const FLOOR_TOKEN = "max(1rem,16px)";

describe("editable text size primitives", () => {
  it("exports a single floor classname without md shrink", () => {
    expect(EDITABLE_TEXT_SIZE_CLASSNAME).toContain(FLOOR_TOKEN);
    expect(EDITABLE_TEXT_SIZE_CLASSNAME).not.toContain("md:text-sm");
    expect(EDITABLE_TEXT_SIZE_CLASSNAME).not.toMatch(/\btext-base\b/);
  });

  it("keeps the floor last when callers pass text-base or text-sm", () => {
    const merged = withEditableTextSize("p-4 text-base", "text-sm");
    expect(merged).toContain(EDITABLE_TEXT_SIZE_CLASSNAME);
    expect(merged).not.toMatch(/\btext-base\b/);
    expect(merged).not.toMatch(/\btext-sm\b/);
  });

  it.each(PRIMITIVE_SOURCES)(
    "%s uses withEditableTextSize / floor and has no md shrink",
    (rel) => {
      const content = readFileSync(path.join(SRC_ROOT, rel), "utf8");
      expect(content).not.toMatch(MD_SHRINK);
      expect(
        content.includes("withEditableTextSize") ||
          content.includes(FLOOR_TOKEN),
      ).toBe(true);
    },
  );
});
