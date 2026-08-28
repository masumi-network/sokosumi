import { describe, expect, it } from "vitest";

import { favorAdminMemberOrganizations } from "./favor-admin-member-organizations";

describe("favorAdminMemberOrganizations", () => {
  const orgs = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
    { id: "c", name: "Gamma" },
  ];

  it("returns the same array when there are no member ids", () => {
    expect(favorAdminMemberOrganizations(orgs, new Set())).toBe(orgs);
  });

  it("puts member orgs first while preserving relative order", () => {
    expect(
      favorAdminMemberOrganizations(orgs, new Set(["c", "a"])).map((o) => o.id),
    ).toEqual(["a", "c", "b"]);
  });

  it("returns the input when nothing matches", () => {
    expect(favorAdminMemberOrganizations(orgs, new Set(["z"]))).toBe(orgs);
  });
});
