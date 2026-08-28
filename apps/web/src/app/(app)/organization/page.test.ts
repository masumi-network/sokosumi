import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));

describe("/organization route alias", () => {
  it("redirects to active org slug detail or home", () => {
    const source = readFileSync(join(dir, "page.tsx"), "utf8");

    expect(source).toContain("userService.getActiveOrganization()");
    expect(source).toContain(
      "`/organizations/${encodeURIComponent(organization.slug)}`",
    );
    expect(source).toContain('redirect("/")');
  });
});
