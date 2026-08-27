import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("organization-chat-list create actions", () => {
  it("does not navigate + to Welcome compose queries", () => {
    const sourcePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../organization-chat-list.client.tsx",
    );
    const source = readFileSync(sourcePath, "utf8");
    expect(source).not.toContain('href="/?create=channel"');
    expect(source).not.toContain('href="/?dm=new"');
    expect(source).toContain("CreateChannelDialog");
    expect(source).toContain("CreateDirectDialog");
  });

  it("keeps create + visible on mobile (no hidden md:flex gate)", () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../app/(app)/chat/components/chat-compose-dialog.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /relative hidden size-7 items-center justify-center rounded-md.*md:flex/,
    );
    expect(source).toMatch(
      /relative flex size-7 items-center justify-center rounded-md/,
    );
  });
});
