import { describe, expect, it } from "vitest";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";

import { buildWorkspaceMoveTargets } from "./workspace-move-targets";

const orgMember = {
  organizationId: "org-a",
  organization: { id: "org-a", name: "Org A" },
} as MemberWithOrganization;

describe("buildWorkspaceMoveTargets", () => {
  it("omits personal when the user has no personal workspace", () => {
    expect(buildWorkspaceMoveTargets("org-a", [orgMember], false)).toEqual([]);
  });

  it("includes personal when the user has a personal workspace", () => {
    expect(buildWorkspaceMoveTargets("org-a", [orgMember], true)).toEqual([
      { id: "personal", organizationId: null },
    ]);
  });
});
