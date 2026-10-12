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
  coreClientFor: () => ({}),
  getAuth: () => ({ api: { getAccessToken } }),
}));

vi.mock("../lib/auth-config", () => ({
  readCmoAuthConfig: () => ({ coreBaseUrl: "https://core.example" }),
}));

vi.mock("@sokosumi/core-client", () => ({ postUsersByIdWorkspaces }));

const { createOrganizationWorkspace, createPersonalWorkspace } = await import(
  "./workspace-actions"
);

const EMPTY = { attempt: 0, name: "", websiteUrl: "", errors: {} };

/** Runs an action to its end; a redirect ends it the way Next does. */
async function settle(run: Promise<unknown>): Promise<void> {
  await run.catch((error: unknown) => {
    if (!String(error).includes("NEXT_REDIRECT")) throw error;
  });
}

function form(name: string, websiteUrl: string) {
  const data = new FormData();
  data.set("name", name);
  data.set("websiteUrl", websiteUrl);
  return data;
}

function coreAnswers(status: number) {
  postUsersByIdWorkspaces.mockResolvedValue({
    ...(status < 300 ? { data: { data: { id: "ws_1" } } } : { error: {} }),
    response: new Response(null, { status }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessToken.mockResolvedValue({ accessToken: "token_123" });
});

describe("createPersonalWorkspace", () => {
  it("creates the personal workspace as the signed in person, then goes home", async () => {
    coreAnswers(201);

    await settle(createPersonalWorkspace());

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
    coreAnswers(409);

    await settle(createPersonalWorkspace());

    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it.each([
    ["Core refuses", () => coreAnswers(500)],
    [
      "Core cannot be reached",
      () =>
        postUsersByIdWorkspaces.mockRejectedValue(
          new TypeError("fetch failed"),
        ),
    ],
  ])("goes home with an error when %s", async (_label, arrange) => {
    arrange();

    await settle(createPersonalWorkspace());

    expect(redirectMock).toHaveBeenCalledWith("/?error=workspace_failed");
  });
});

describe("createOrganizationWorkspace", () => {
  it("creates the organization as the signed in person, then goes home", async () => {
    coreAnswers(201);

    await settle(
      createOrganizationWorkspace(EMPTY, form("  Acme  ", " acme.com ")),
    );

    expect(postUsersByIdWorkspaces).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "me" },
        body: { kind: "organization", name: "Acme", websiteUrl: "acme.com" },
        headers: { authorization: "Bearer token_123" },
      }),
    );
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("returns field errors and keeps the values without asking Core", async () => {
    const state = await createOrganizationWorkspace(
      EMPTY,
      form("A", "not a website"),
    );

    expect(state).toEqual({
      attempt: 1,
      name: "A",
      websiteUrl: "not a website",
      errors: {
        name: "Use 2 to 50 characters.",
        websiteUrl: "Enter a website, like acme.com.",
      },
    });
    expect(postUsersByIdWorkspaces).not.toHaveBeenCalled();
  });

  it("rejects a name over 50 characters", async () => {
    const state = await createOrganizationWorkspace(
      EMPTY,
      form("A".repeat(51), "acme.com"),
    );

    expect(state.errors).toEqual({ name: "Use 2 to 50 characters." });
  });

  it("says when the organization limit is reached", async () => {
    coreAnswers(403);

    const state = await createOrganizationWorkspace(
      EMPTY,
      form("Acme", "acme.com"),
    );

    expect(state.errors).toEqual({
      form: "You have reached the limit of organizations.",
    });
    expect(state).toMatchObject({ name: "Acme", websiteUrl: "acme.com" });
  });

  it.each([
    ["Core refuses", () => coreAnswers(422)],
    [
      "Core cannot be reached",
      () =>
        postUsersByIdWorkspaces.mockRejectedValue(
          new TypeError("fetch failed"),
        ),
    ],
  ])("says it did not work when %s", async (_label, arrange) => {
    arrange();

    const state = await createOrganizationWorkspace(
      EMPTY,
      form("Acme", "acme.com"),
    );

    expect(state.errors).toEqual({ form: "That did not work. Try again." });
  });
});

describe("both workspace actions", () => {
  const actions = [
    ["Just me", () => createPersonalWorkspace()],
    [
      "the organization step",
      () => createOrganizationWorkspace(EMPTY, form("Acme", "acme.com")),
    ],
  ] as const;

  it.each(actions)(
    "%s goes home when the access token cannot be read",
    async (_label, run) => {
      getAccessToken.mockRejectedValue(new Error("ACCOUNT_NOT_FOUND"));

      await settle(run());

      expect(redirectMock).toHaveBeenCalledWith("/");
      expect(postUsersByIdWorkspaces).not.toHaveBeenCalled();
    },
  );

  it.each(actions)(
    "%s goes home when Core refuses the token",
    async (_label, run) => {
      coreAnswers(401);

      await settle(run());

      expect(redirectMock).toHaveBeenCalledWith("/");
    },
  );
});
