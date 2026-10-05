import { beforeEach, describe, expect, it, vi } from "vitest";

const getAccessToken = vi.fn();
const postUsersByIdWorkspaces = vi.fn();
const redirectMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "cmo.session_token=abc" }),
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    redirect: (url: string) => {
      redirectMock(url);
      return actual.redirect(url);
    },
  };
});

vi.mock("../lib/auth", () => ({
  getAuth: () => ({ api: { getAccessToken } }),
}));

vi.mock("../lib/auth-config", () => ({
  readCmoAuthConfig: () => ({ coreBaseUrl: "https://core.example" }),
}));

vi.mock("@sokosumi/core-client", () => ({ postUsersByIdWorkspaces }));

const { createPersonalWorkspace } = await import("./workspace-actions");

async function settle(action: () => Promise<void>) {
  await action().catch((error: unknown) => {
    if (!String(error).includes("NEXT_REDIRECT")) throw error;
  });
}

describe("createPersonalWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue({ accessToken: "token_123" });
  });

  it("creates the personal workspace as the signed in person, then goes home", async () => {
    postUsersByIdWorkspaces.mockResolvedValue({
      data: { data: { id: "ws_1" } },
      response: new Response(null, { status: 201 }),
    });

    await settle(createPersonalWorkspace);

    expect(postUsersByIdWorkspaces).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "me" },
        body: { kind: "personal" },
        headers: { authorization: "Bearer token_123" },
      }),
    );
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("goes home when the personal workspace already exists", async () => {
    postUsersByIdWorkspaces.mockResolvedValue({
      error: { error: "Conflict" },
      response: new Response(null, { status: 409 }),
    });

    await settle(createPersonalWorkspace);

    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it.each([
    [
      "Core refuses",
      () =>
        postUsersByIdWorkspaces.mockResolvedValue({
          error: { error: "Internal Server Error" },
          response: new Response(null, { status: 500 }),
        }),
    ],
    [
      "Core cannot be reached",
      () =>
        postUsersByIdWorkspaces.mockRejectedValue(
          new TypeError("fetch failed"),
        ),
    ],
    [
      "the access token cannot be read",
      () => getAccessToken.mockRejectedValue(new Error("ACCOUNT_NOT_FOUND")),
    ],
  ])("goes home with an error when %s", async (_label, arrange) => {
    arrange();

    await settle(createPersonalWorkspace);

    expect(redirectMock).toHaveBeenCalledWith("/?error=workspace_failed");
  });
});
