import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EDITABLE_TEXT_SIZE_CLASSNAME } from "@/lib/utils/editable-text-size";

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
const CONSTANT_IMPORT = "EDITABLE_TEXT_SIZE_CLASSNAME";

describe("editable text size primitives", () => {
  it("exports a floor classname without md shrink", () => {
    expect(EDITABLE_TEXT_SIZE_CLASSNAME).toContain("text-base");
    expect(EDITABLE_TEXT_SIZE_CLASSNAME).toContain(FLOOR_TOKEN);
    expect(EDITABLE_TEXT_SIZE_CLASSNAME).not.toContain("md:text-sm");
  });

  it.each(PRIMITIVE_SOURCES)(
    "%s uses editable floor and has no md shrink on editables",
    (rel) => {
      const content = readFileSync(path.join(SRC_ROOT, rel), "utf8");
      expect(content).not.toMatch(MD_SHRINK);
      expect(
        content.includes(CONSTANT_IMPORT) || content.includes(FLOOR_TOKEN),
      ).toBe(true);
    },
  );
});
