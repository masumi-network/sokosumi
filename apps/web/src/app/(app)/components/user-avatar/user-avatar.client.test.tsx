import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));

describe("UserAvatarClient settings organization item", () => {
  it("links to /organization with singular translation key (not slug list path)", () => {
    const source = readFileSync(join(dir, "user-avatar.client.tsx"), "utf8");

    expect(source).toContain('handleClick(e, "/organization")');
    expect(source).toContain('t("organization")');
    expect(source).not.toContain(
      "`/organizations/${activeOrganizationMember.organization.slug}`",
    );
    expect(source).not.toContain('t("organizations")');
  });
});

describe("/organization route alias", () => {
  it("redirects to active org slug detail or home", () => {
    const source = readFileSync(
      join(dir, "../../organization/page.tsx"),
      "utf8",
    );

    expect(source).toContain("userService.getActiveOrganization()");
    expect(source).toContain(
      "`/organizations/${encodeURIComponent(organization.slug)}`",
    );
    expect(source).toContain('redirect("/")');
  });
});
