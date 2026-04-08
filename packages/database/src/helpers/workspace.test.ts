import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

const findWorkspaceForContextMock = vi.fn();
const upsertWorkspaceForContextMock = vi.fn();

vi.mock("../repositories/workspace.repository.js", () => ({
  workspaceRepository: {
    findWorkspaceForContext: (...args: unknown[]) =>
      findWorkspaceForContextMock(...args),
    upsertWorkspaceForContext: (...args: unknown[]) =>
      upsertWorkspaceForContextMock(...args),
  },
}));

import {
  findWorkspaceForContext,
  resolveWorkspaceForContext,
} from "./workspace.js";

describe("workspace helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes undefined organization ids to null for lookups", async () => {
    findWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });

    const tx = {} as never;
    const workspace = await findWorkspaceForContext("user_123", undefined, tx);

    expect(findWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      null,
      tx,
    );
    assert.equal(workspace?.id, "11111111-1111-7111-8111-111111111111");
  });

  it("normalizes undefined organization ids to null for ensure semantics", async () => {
    upsertWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });

    const tx = {} as never;
    const workspace = await resolveWorkspaceForContext(
      "user_123",
      undefined,
      tx,
    );

    expect(upsertWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      null,
      tx,
    );
    assert.equal(workspace.id, "11111111-1111-7111-8111-111111111111");
  });
});
