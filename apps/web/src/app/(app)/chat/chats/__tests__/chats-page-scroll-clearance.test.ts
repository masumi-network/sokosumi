import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CHAT_CHATS_MOBILE_LIST_SHELL_CLASS } from "../chat-chats-list-shell";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Mobile `/chat/chats` must clear the fixed bottom nav:
 * 1. Grow with content so AppMobileChrome's in-flow tab-bar spacer sits after
 *    the last DM in main's scroll (no nested min-h-0 + overflow-y-auto).
 * 2. Cancel main `p-4` on top/sides only — never `-m-4` / `-mb-4` (negative
 *    bottom margin pulls the spacer into the last rows).
 * 3. Keep a small `pb-*` gap above the tab bar for comfortable clearance.
 * Create FAB is gone on this surface — do not reserve FAB bottom padding.
 */
describe("chat/chats page scroll clearance contract", () => {
  it("locks the shared mobile list shell inset classes", () => {
    expect(CHAT_CHATS_MOBILE_LIST_SHELL_CLASS).toContain("md:hidden");
    expect(CHAT_CHATS_MOBILE_LIST_SHELL_CLASS).toContain("-mt-4");
    expect(CHAT_CHATS_MOBILE_LIST_SHELL_CLASS).toContain("-mx-4");
    expect(CHAT_CHATS_MOBILE_LIST_SHELL_CLASS).toContain("pb-3");
    expect(CHAT_CHATS_MOBILE_LIST_SHELL_CLASS).toContain("flex-1");
    expect(CHAT_CHATS_MOBILE_LIST_SHELL_CLASS).toContain("flex-col");
    // Full four-side cancel (or any -mb) reintroduces the clip.
    expect(CHAT_CHATS_MOBILE_LIST_SHELL_CLASS).not.toMatch(
      /(?:^|\s)-m-4(?:\s|$)/,
    );
    expect(CHAT_CHATS_MOBILE_LIST_SHELL_CLASS).not.toMatch(/-mb-/);
    expect(CHAT_CHATS_MOBILE_LIST_SHELL_CLASS).not.toMatch(/overflow-y-auto/);
    expect(CHAT_CHATS_MOBILE_LIST_SHELL_CLASS).not.toMatch(/\bmin-h-0\b/);
    expect(CHAT_CHATS_MOBILE_LIST_SHELL_CLASS).not.toMatch(
      /LIST_MOBILE_CREATE_FAB_CLEARANCE|pb-\[calc\(3\.5rem/,
    );
  });

  it("page mounts the shared shell class (no local -m-4 / overflow lock)", () => {
    const source = readFileSync(join(here, "../page.tsx"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");

    // Require the className binding — a bare import would still match the
    // identifier alone and would not prove the shell mounts on the list root.
    expect(code).toMatch(/className=\{CHAT_CHATS_MOBILE_LIST_SHELL_CLASS\}/);
    expect(code).not.toMatch(/LIST_MOBILE_CREATE_FAB_CLEARANCE/);
    expect(code).not.toMatch(/overflow-y-auto/);
    expect(code).not.toMatch(/\bmin-h-0\b/);
    // Inline four-side cancel would bypass the shared constant.
    expect(code).not.toMatch(/className="[^"]*-m-4[^"]*"/);
    expect(code).not.toMatch(/className=\{[^}]*-m-4[^}]*\}/);
  });
});
