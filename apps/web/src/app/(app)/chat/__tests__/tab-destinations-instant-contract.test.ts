import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "../..");

function readApp(rel: string): string {
  return readFileSync(join(appDir, rel), "utf8");
}

describe("mobile tab destinations Instant Nav contract", () => {
  const pages = [
    "chat/page.tsx",
    "chat/chats/page.tsx",
    "history/page.tsx",
  ] as const;

  for (const rel of pages) {
    it(`${rel} does not soft-nav opt out of Instant`, () => {
      const source = readApp(rel);
      expect(source).not.toMatch(/export\s+const\s+instant\s*=\s*false/);
    });
  }

  it("chat/loading.tsx renders ChatHomePageSkeleton", () => {
    const source = readApp("chat/loading.tsx");
    expect(source).toMatch(/ChatHomePageSkeleton/);
  });

  it("chat/chats/loading.tsx renders ChatChatsPageSkeleton", () => {
    const source = readApp("chat/chats/loading.tsx");
    expect(source).toMatch(/ChatChatsPageSkeleton/);
  });

  it("history/loading.tsx renders HistoryPageSkeleton", () => {
    const source = readApp("history/loading.tsx");
    expect(source).toMatch(/HistoryPageSkeleton/);
  });
});
