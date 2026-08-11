import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Mobile `/chat/chats` must grow with content so AppMobileChrome's in-flow
 * tab-bar spacer sits after the last DM in main's scroll. A nested
 * `min-h-0` + `overflow-y-auto` height-lock left the last row clipped under
 * the fixed bottom nav (padding on that flex overflow child does not clear).
 */
describe("chat/chats page scroll clearance contract", () => {
  it("does not height-lock the list shell and keeps FAB clearance", () => {
    const source = readFileSync(join(here, "../page.tsx"), "utf8");

    // Drop block comments so docs mentioning the forbidden classes do not
    // false-positive; still catch real className usage.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    // Require clearance on the mobile shell className, not merely imported.
    expect(code).toMatch(
      /className=\{cn\([\s\S]*?LIST_MOBILE_CREATE_FAB_CLEARANCE/,
    );
    expect(code).not.toMatch(/overflow-y-auto/);
    expect(code).not.toMatch(/\bmin-h-0\b/);
  });
});
