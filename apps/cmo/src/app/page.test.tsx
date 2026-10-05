import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NameSetup } from "../components/name-setup";
import { OrganizationSetup } from "../components/organization-setup";
import { SignedIn } from "../components/signed-in";
import { SignedOut } from "../components/signed-out";
import { WorkspaceGate } from "../components/workspace-gate";

const getSession = vi.fn();
const getUsersById = vi.fn();
const getUsersByIdWorkspaces = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("../lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));

vi.mock("../lib/core", () => ({
  asSignedInPersonInPage: async () => ({
    headers: { authorization: "Bearer token_123" },
  }),
}));

vi.mock("@sokosumi/core-client", () => ({
  getUsersById,
  getUsersByIdWorkspaces,
}));

vi.mock("./actions", () => ({
  createAccount: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("./name-actions", () => ({ saveName: vi.fn() }));

vi.mock("./workspace-actions", () => ({
  createOrganizationWorkspace: vi.fn(),
  createPersonalWorkspace: vi.fn(),
}));

const { default: HomePage } = await import("./page");

function render(
  error?: string | string[],
  step?: string | string[],
): Promise<ReactElement<{ failed?: boolean; error?: string }>> {
  return HomePage({ searchParams: Promise.resolve({ error, step }) });
}

function workspacesAnswer(workspaces: unknown[]) {
  return {
    data: { data: { workspaces, pendingInvitationCount: 0 } },
    response: new Response(null, { status: 200 }),
  };
}

function userAnswer(firstName: string | null, lastName: string | null) {
  return {
    data: { data: { id: "user_1", name: "Ada", firstName, lastName } },
    response: new Response(null, { status: 200 }),
  };
}

describe("CMO home page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({
      user: { name: "Ada Lovelace", email: "ada@example.com" },
    });
    getUsersById.mockResolvedValue(userAnswer("Ada", "Lovelace"));
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

  it("tells the gate when the error query repeats", async () => {
    getUsersByIdWorkspaces.mockResolvedValue(workspacesAnswer([]));

    const page = await render(["workspace_failed", "workspace_failed"]);

    expect(page.props.failed).toBe(true);
  });

  it("shows the organization step to a person with no workspace", async () => {
    getUsersByIdWorkspaces.mockResolvedValue(workspacesAnswer([]));

    expect((await render(undefined, "organization")).type).toBe(
      OrganizationSetup,
    );
  });

  it("does not show the organization step to a person with a workspace", async () => {
    getUsersByIdWorkspaces.mockResolvedValue(
      workspacesAnswer([{ id: "ws_1", kind: "personal", preferred: true }]),
    );

    expect((await render(undefined, "organization")).type).toBe(SignedIn);
  });

  it("lets a person with a workspace into CMO", async () => {
    getUsersByIdWorkspaces.mockResolvedValue(
      workspacesAnswer([{ id: "ws_1", kind: "personal", preferred: true }]),
    );

    expect((await render()).type).toBe(SignedIn);
    // Only the gate needs the name parts.
    expect(getUsersById).not.toHaveBeenCalled();
  });

  it.each([
    ["no name parts", null, null],
    ["only a first name", "Ada", null],
    ["blank parts", " ", " "],
    ["a name too long to store", "A".repeat(64), "B".repeat(64)],
  ])(
    "asks a person with no workspace and %s for their name first",
    async (_label, firstName, lastName) => {
      getUsersByIdWorkspaces.mockResolvedValue(workspacesAnswer([]));
      getUsersById.mockResolvedValue(userAnswer(firstName, lastName));

      const page = await render();

      expect(page.type).toBe(NameSetup);
      expect(getUsersById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: "me" },
          headers: { authorization: "Bearer token_123" },
        }),
      );
    },
  );

  it("asks for the name before the organization step", async () => {
    getUsersByIdWorkspaces.mockResolvedValue(workspacesAnswer([]));
    getUsersById.mockResolvedValue(userAnswer(null, null));

    expect((await render(undefined, "organization")).type).toBe(NameSetup);
  });

  it("fails into the error page when Core cannot read the person", async () => {
    getUsersByIdWorkspaces.mockResolvedValue(workspacesAnswer([]));
    getUsersById.mockResolvedValue({
      error: { error: "Internal Server Error" },
      response: new Response(null, { status: 500 }),
    });

    await expect(render()).rejects.toThrow("(500)");
  });

  it("fails into the error page when Core cannot list workspaces", async () => {
    getUsersByIdWorkspaces.mockResolvedValue({
      error: { error: "Internal Server Error" },
      response: new Response(null, { status: 500 }),
    });

    await expect(render()).rejects.toThrow("(500)");
  });

  it.each([
    ["listing workspaces", 401],
    ["listing workspaces", 403],
    ["reading the person", 401],
    ["reading the person", 403],
  ])(
    "shows the signed-out page when Core refuses the token %s (%i)",
    async (call, status) => {
      const refused = {
        error: { error: "Unauthorized" },
        response: new Response(null, { status }),
      };
      if (call === "listing workspaces") {
        getUsersByIdWorkspaces.mockResolvedValue(refused);
      } else {
        getUsersByIdWorkspaces.mockResolvedValue(workspacesAnswer([]));
        getUsersById.mockResolvedValue(refused);
      }

      const page = await render();

      expect(page.type).toBe(SignedOut);
      expect(page.props).toMatchObject({ error: "signed_out" });
    },
  );

  it("does not show a gate error as a sign-in failure after signing out elsewhere", async () => {
    getSession.mockResolvedValue(null);

    const page = await render("workspace_failed");

    expect(page.type).toBe(SignedOut);
    expect(page.props).toMatchObject({ error: undefined });
  });
});
