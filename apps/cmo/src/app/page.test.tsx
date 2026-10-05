import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignedIn } from "../components/signed-in";
import { SignedOut } from "../components/signed-out";
import { WorkspaceGate } from "../components/workspace-gate";

const getSession = vi.fn();
const getUsersByIdWorkspaces = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("../lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));

vi.mock("../lib/core", () => ({
  asSignedInPerson: async () => ({
    headers: { authorization: "Bearer token_123" },
  }),
}));

vi.mock("@sokosumi/core-client", () => ({ getUsersByIdWorkspaces }));

vi.mock("./actions", () => ({
  createAccount: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("./workspace-actions", () => ({
  createPersonalWorkspace: vi.fn(),
}));

const { default: HomePage } = await import("./page");

function render(error?: string): Promise<ReactElement<{ failed?: boolean }>> {
  return HomePage({ searchParams: Promise.resolve({ error }) });
}

function workspacesAnswer(workspaces: unknown[]) {
  return {
    data: { data: { workspaces, pendingInvitationCount: 0 } },
    response: new Response(null, { status: 200 }),
  };
}

describe("CMO home page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({
      user: { name: "Ada Lovelace", email: "ada@example.com" },
    });
  });

  it("shows the signed-out page without a session, without asking Core", async () => {
    getSession.mockResolvedValue(null);

    expect((await render()).type).toBe(SignedOut);
    expect(getUsersByIdWorkspaces).not.toHaveBeenCalled();
  });

  it("holds a person with no workspace at the workspace gate", async () => {
    getUsersByIdWorkspaces.mockResolvedValue(workspacesAnswer([]));

    const page = await render();

    expect(page.type).toBe(WorkspaceGate);
    expect(page.props.failed).toBe(false);
    expect(getUsersByIdWorkspaces).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "me" },
        headers: { authorization: "Bearer token_123" },
      }),
    );
  });

  it("tells the gate when the last choice failed", async () => {
    getUsersByIdWorkspaces.mockResolvedValue(workspacesAnswer([]));

    expect((await render("workspace_failed")).props.failed).toBe(true);
  });

  it("lets a person with a workspace into CMO", async () => {
    getUsersByIdWorkspaces.mockResolvedValue(
      workspacesAnswer([{ id: "ws_1", kind: "personal", preferred: true }]),
    );

    expect((await render()).type).toBe(SignedIn);
  });

  it("fails into the error page when Core cannot list workspaces", async () => {
    // With throwOnError the generated client rejects on any non-2xx answer.
    const failure = new Error("Internal Server Error");
    getUsersByIdWorkspaces.mockRejectedValue(failure);

    await expect(render()).rejects.toBe(failure);
    expect(getUsersByIdWorkspaces).toHaveBeenCalledWith(
      expect.objectContaining({ throwOnError: true }),
    );
  });
});
