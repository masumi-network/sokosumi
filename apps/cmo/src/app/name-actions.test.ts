import { beforeEach, describe, expect, it, vi } from "vitest";

const getAccessToken = vi.fn();
const patchUsersById = vi.fn();
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

vi.mock("@sokosumi/core-client", () => ({ patchUsersById }));

const { saveName } = await import("./name-actions");

const EMPTY = { attempt: 0, firstName: "", lastName: "", errors: {} };

/** Runs an action to its end; a redirect ends it the way Next does. */
async function settle(run: Promise<unknown>): Promise<void> {
  await run.catch((error: unknown) => {
    if (!String(error).includes("NEXT_REDIRECT")) throw error;
  });
}

function form(firstName: string, lastName: string) {
  const data = new FormData();
  data.set("firstName", firstName);
  data.set("lastName", lastName);
  return data;
}

function coreAnswers(status: number) {
  patchUsersById.mockResolvedValue({
    ...(status < 300 ? { data: { data: { id: "user_1" } } } : { error: {} }),
    response: new Response(null, { status }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessToken.mockResolvedValue({ accessToken: "token_123" });
});

describe("saveName", () => {
  it("saves the trimmed name as the signed in person, then goes home", async () => {
    coreAnswers(200);

    await settle(saveName(EMPTY, form("  Ada ", " Lovelace  ")));

    expect(patchUsersById).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "me" },
        body: { firstName: "Ada", lastName: "Lovelace" },
        headers: { authorization: "Bearer token_123" },
      }),
    );
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("asks for both parts and keeps the values without asking Core", async () => {
    const state = await saveName(EMPTY, form(" ", ""));

    expect(state).toEqual({
      attempt: 1,
      firstName: "",
      lastName: "",
      errors: {
        firstName: "Enter your first name.",
        lastName: "Enter your last name.",
      },
    });
    expect(patchUsersById).not.toHaveBeenCalled();
  });

  it("keeps the part that was given", async () => {
    const state = await saveName(EMPTY, form("Ada", ""));

    expect(state).toMatchObject({
      firstName: "Ada",
      errors: { lastName: "Enter your last name." },
    });
    expect(state.errors.firstName).toBeUndefined();
  });

  it("rejects a name longer than Sokosumi allows", async () => {
    const state = await saveName(EMPTY, form("A".repeat(64), "B".repeat(64)));

    expect(state.errors).toEqual({ lastName: "Use a shorter name." });
    expect(patchUsersById).not.toHaveBeenCalled();
  });

  it.each([
    ["Core refuses", () => coreAnswers(422)],
    [
      "Core cannot be reached",
      () => patchUsersById.mockRejectedValue(new TypeError("fetch failed")),
    ],
  ])("says it did not work when %s", async (_label, arrange) => {
    arrange();

    const state = await saveName(EMPTY, form("Ada", "Lovelace"));

    expect(state).toEqual({
      attempt: 1,
      firstName: "Ada",
      lastName: "Lovelace",
      errors: { form: "That did not work. Try again." },
    });
  });

  it("goes home when the access token cannot be read", async () => {
    getAccessToken.mockRejectedValue(new Error("ACCOUNT_NOT_FOUND"));

    await settle(saveName(EMPTY, form("Ada", "Lovelace")));

    expect(redirectMock).toHaveBeenCalledWith("/");
    expect(patchUsersById).not.toHaveBeenCalled();
  });

  it("goes home when Core refuses the token", async () => {
    coreAnswers(401);

    await settle(saveName(EMPTY, form("Ada", "Lovelace")));

    expect(redirectMock).toHaveBeenCalledWith("/");
  });
});
