import { beforeEach, describe, expect, it, vi } from "vitest";

import { isLastWorkspace } from "./workspace-access.js";

describe("isLastWorkspace", () => {
  const workspaceFindUnique = vi.fn();
  const memberFindFirst = vi.fn();

  const tx = {
    workspace: { findUnique: workspaceFindUnique },
    member: { findFirst: memberFindFirst },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses delete of a personal workspace when the user has no org membership", async () => {
    memberFindFirst.mockResolvedValue(null);

    await expect(
      isLastWorkspace("user_1", { type: "personal" }, tx),
    ).resolves.toBe(true);
    expect(workspaceFindUnique).not.toHaveBeenCalled();
  });

  it("allows delete of a personal workspace when an org membership remains", async () => {
    memberFindFirst.mockResolvedValue({ id: "member_1" });

    await expect(
      isLastWorkspace("user_1", { type: "personal" }, tx),
    ).resolves.toBe(false);
  });

  it("refuses delete of an organization when it is the only workspace", async () => {
    workspaceFindUnique.mockResolvedValue(null);
    memberFindFirst.mockResolvedValue(null);

    await expect(
      isLastWorkspace(
        "user_1",
        { type: "organization", organizationId: "org_1" },
        tx,
      ),
    ).resolves.toBe(true);
  });

  it("allows delete of an organization when a personal workspace remains", async () => {
    workspaceFindUnique.mockResolvedValue({ id: "ws_personal" });

    await expect(
      isLastWorkspace(
        "user_1",
        { type: "organization", organizationId: "org_1" },
        tx,
      ),
    ).resolves.toBe(false);
    expect(memberFindFirst).not.toHaveBeenCalled();
  });

  it("allows delete of an organization when another org membership remains", async () => {
    workspaceFindUnique.mockResolvedValue(null);
    memberFindFirst.mockResolvedValue({ id: "member_other" });

    await expect(
      isLastWorkspace(
        "user_1",
        { type: "organization", organizationId: "org_1" },
        tx,
      ),
    ).resolves.toBe(false);
  });
});
