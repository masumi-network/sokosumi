import { beforeEach, describe, expect, it, vi } from "vitest";

const signInSocial = vi.fn();
const signOutApi = vi.fn();
const redirectMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    // Records the target, then throws Next's control-flow error as it does.
    redirect: (url: string) => {
      redirectMock(url);
      return actual.redirect(url);
    },
  };
});

vi.mock("../lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/auth")>()),
  getAuth: () => ({
    api: { signInSocial, signOut: signOutApi },
  }),
}));

const { notFound } = await import("next/navigation");
const { createAccount, signIn, signOut } = await import("./actions");

/** Runs an action to its redirect, which Next throws to end the action. */
async function settle(action: () => Promise<void>) {
  await action().catch((error: unknown) => {
    if (!String(error).includes("NEXT_REDIRECT")) throw error;
  });
}

describe("CMO sign-in actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInSocial.mockResolvedValue({
      headers: new Headers(),
      response: { url: "https://core.example/authorize" },
    });
  });

  it.each([
    ["Sign in", signIn, undefined],
    ["Create account", createAccount, "create"],
  ] as const)(
    "%s goes to Core's authorize URL",
    async (_case, action, prompt) => {
      await settle(action);

      expect(
        signInSocial.mock.lastCall?.[0].body.additionalParams?.prompt,
      ).toBe(prompt);
      expect(redirectMock).toHaveBeenCalledWith(
        "https://core.example/authorize",
      );
    },
  );

  it("signs out and goes home", async () => {
    await settle(signOut);

    expect(signOutApi).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it.each([
    [
      "Better Auth returns no authorize URL",
      () =>
        signInSocial.mockResolvedValue({
          headers: new Headers(),
          response: {},
        }),
    ],
    [
      "Core cannot be reached",
      () => signInSocial.mockRejectedValue(new TypeError("fetch failed")),
    ],
  ])("explains on the signed-out page when %s", async (_case, arrange) => {
    arrange();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const action of [signIn, createAccount]) {
      redirectMock.mockClear();
      await settle(action);

      expect(redirectMock.mock.calls).toEqual([["/?error=unavailable"]]);
    }
    expect(logged).toHaveBeenCalledWith(
      "Starting Sign in with Sokosumi failed",
      expect.anything(),
    );
    logged.mockRestore();
  });

  it("lets Next's own control flow through", async () => {
    signInSocial.mockImplementation(async () => notFound());

    await expect(signIn()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
