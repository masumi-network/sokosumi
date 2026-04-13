import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrganizationWorkspaceMock = vi.fn();
const getPersonalWorkspaceMock = vi.fn();
const upsertOrganizationWorkspaceMock = vi.fn();
const upsertPersonalWorkspaceMock = vi.fn();

vi.mock("../repositories/workspace.repository.js", () => ({
  workspaceRepository: {
    getOrganizationWorkspace: (...args: unknown[]) =>
      getOrganizationWorkspaceMock(...args),
    getPersonalWorkspace: (...args: unknown[]) =>
      getPersonalWorkspaceMock(...args),
    upsertOrganizationWorkspace: (...args: unknown[]) =>
      upsertOrganizationWorkspaceMock(...args),
    upsertPersonalWorkspace: (...args: unknown[]) =>
      upsertPersonalWorkspaceMock(...args),
  },
}));

import { upsertWorkspace } from "./workspace.js";

describe("workspace helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the personal workspace upsert when organization id is undefined", async () => {
    upsertPersonalWorkspaceMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });

    const tx = {} as never;
    const workspace = await upsertWorkspace("user_123", undefined, tx);

    expect(upsertPersonalWorkspaceMock).toHaveBeenCalledWith("user_123", tx);
    expect(upsertOrganizationWorkspaceMock).not.toHaveBeenCalled();
    assert.equal(workspace.id, "11111111-1111-7111-8111-111111111111");
  });

  it("uses the organization workspace upsert when organization id is present", async () => {
    upsertOrganizationWorkspaceMock.mockResolvedValue({
      id: "22222222-2222-7222-8222-222222222222",
    });

    const tx = {} as never;
    const workspace = await upsertWorkspace("user_123", "org_123", tx);

    expect(upsertOrganizationWorkspaceMock).toHaveBeenCalledWith("org_123", tx);
    expect(upsertPersonalWorkspaceMock).not.toHaveBeenCalled();
    assert.equal(workspace.id, "22222222-2222-7222-8222-222222222222");
  });
});
