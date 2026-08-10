import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("organization-chat-list SectionHeader create link", () => {
  it("shows create + on mobile (no hidden md:flex gate)", () => {
    const sourcePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../organization-chat-list.client.tsx",
    );
    const source = readFileSync(sourcePath, "utf8");
    expect(source).not.toMatch(
      /relative hidden size-7 items-center justify-center rounded-md.*md:flex/,
    );
    expect(source).toMatch(
      /relative flex size-7 items-center justify-center rounded-md/,
    );
  });
});
