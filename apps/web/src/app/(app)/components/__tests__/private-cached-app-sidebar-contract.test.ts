import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("PrivateCachedAppSidebar session contract", () => {
  // The chat block moved into its own slot (feed mode); the contract holds
  // for the frame and the slot together.
  const source = [
    "../private-cached-app-sidebar.tsx",
    "../sidebar/components/sidebar-chat-slot.tsx",
  ]
    .map((path) =>
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), "utf8"),
    )
    .join("\n");

  it("does not re-fetch session and return null empty chrome", () => {
    expect(source).not.toMatch(/\bgetSession\s*\(/);
    expect(source).not.toMatch(/\breturn\s+null\b/);
  });

  it("takes sessionUser from the authenticated frame instead", () => {
    expect(source).toMatch(/sessionUser:\s*SessionUser/);
  });

  it("does not block rooms chrome on pending invites, credits, or vendor-admin", () => {
    expect(source).toMatch(/loadSidebarChatList/);
    expect(source).not.toMatch(/listPendingInvitations/);
    expect(source).not.toMatch(/getCachedMyCredits/);
    expect(source).not.toMatch(/getDeveloperVendorAdminAccess/);
    expect(source).not.toMatch(/resolvePlanName/);
  });

  it("does not own private-cache directives; the shared loader does", () => {
    expect(source).not.toMatch(/"use cache: private"/);
    expect(source).not.toMatch(/\bcacheLife\b/);
    expect(source).not.toMatch(/\bcacheTag\b/);
  });
});
