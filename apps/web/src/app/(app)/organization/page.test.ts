import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));

describe("/organization route", () => {
  it("renders active-org settings in place without hopping to the slug route", () => {
    const source = readFileSync(join(dir, "page.tsx"), "utf8");

    expect(source).toContain("OrganizationSettingsContent");
    expect(source).toContain("userService.getActiveOrganizationId()");
    expect(source).toContain("userService.getMyMembersWithOrganizations()");
    expect(source).toContain('redirect("/")');
    expect(source).not.toContain("/organizations/${");
    expect(source).not.toContain("getActiveOrganization()");
  });
});
