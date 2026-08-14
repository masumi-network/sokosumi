import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "../..");

/** Dynamic APIs that must not appear in Instant loading shell *code*. */
const DYNAMIC_SHELL_API_RE =
  /\bcookies\s*\(|\bconnection\s*\(|\bgetTranslations\s*\(|\bgetSession\s*\(/;

function readApp(rel: string): string {
  return readFileSync(join(appDir, rel), "utf8");
}

/** Drop comments so "no connection()" docs do not false-positive the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("mobile tab destinations Instant Nav contract", () => {
  const pages = [
    "(welcome)/page.tsx",
    "chat/page.tsx",
    "history/page.tsx",
  ] as const;

  const loadingShells = [
    "(welcome)/loading.tsx",
    "chat/loading.tsx",
    "history/loading.tsx",
    "chat/components/chat-home-loading-view.tsx",
    "chat/components/chat-chats-loading-view.tsx",
    "history/components/history-loading-view.tsx",
  ] as const;

  for (const rel of pages) {
    it(`${rel} does not soft-nav opt out of Instant`, () => {
      const source = readApp(rel);
      expect(source).not.toMatch(/export\s+const\s+instant\s*=\s*false/);
    });
  }

  for (const rel of loadingShells) {
    it(`${rel} stays sync (no cookies/connection/session/i18n)`, () => {
      const code = stripComments(readApp(rel));
      expect(code).not.toMatch(DYNAMIC_SHELL_API_RE);
    });
  }

  it("(welcome)/loading.tsx default export returns ChatHomePageSkeleton", () => {
    const code = stripComments(readApp("(welcome)/loading.tsx"));
    expect(code).toMatch(
      /export\s+default\s+function[\s\S]*?return\s+<\s*ChatHomePageSkeleton\s*\/>/,
    );
  });

  it("chat/loading.tsx default export returns ChatChatsPageSkeleton", () => {
    const code = stripComments(readApp("chat/loading.tsx"));
    expect(code).toMatch(
      /export\s+default\s+function[\s\S]*?return\s+<\s*ChatChatsPageSkeleton\s*\/>/,
    );
  });

  it("history/loading.tsx default export returns HistoryPageSkeleton", () => {
    const code = stripComments(readApp("history/loading.tsx"));
    expect(code).toMatch(
      /export\s+default\s+function[\s\S]*?return\s+<\s*HistoryPageSkeleton\s*\/>/,
    );
  });
});
