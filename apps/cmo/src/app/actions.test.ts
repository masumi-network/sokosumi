import { beforeEach, describe, expect, it, vi } from "vitest";

const signInSocial = vi.fn();
const signOutApi = vi.fn();
const redirectMock = vi.fn();

const cookieJar = new Map<string, { value: string; options: unknown }>();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    set: (name: string, value: string, options: unknown) =>
      cookieJar.set(name, { value, options }),
  }),
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
const { continueWithWebsite, signIn, signOut } = await import("./actions");
const { KEPT_WEBSITE_COOKIE, KEPT_WEBSITE_OPTIONS } = await import(
  "../lib/kept-website"
);

/** Runs an action to its redirect, which Next throws to end the action. */
async function settle(action: () => Promise<void>) {
  await action().catch((error: unknown) => {
    if (!String(error).includes("NEXT_REDIRECT")) throw error;
  });
}

describe("CMO sign-in actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieJar.clear();
    signInSocial.mockResolvedValue({
      headers: new Headers(),
      response: { url: "https://core.example/authorize" },
    });
  });

  it("Sign in goes to Core's authorize URL", async () => {
    await settle(signIn);

    expect(
      signInSocial.mock.lastCall?.[0].body.additionalParams?.prompt,
    ).toBeUndefined();
    expect(redirectMock).toHaveBeenCalledWith("https://core.example/authorize");
  });

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

    await settle(signIn);

    expect(redirectMock.mock.calls).toEqual([["/?error=unavailable"]]);
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

describe("the website before sign in", () => {
  const EMPTY = { attempt: 0, websiteUrl: "", errors: {} };

  function form(websiteUrl: string) {
    const data = new FormData();
    data.set("websiteUrl", websiteUrl);
    return data;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    cookieJar.clear();
    signInSocial.mockResolvedValue({
      headers: new Headers(),
      response: { url: "https://core.example/authorize" },
    });
  });

  it("keeps the website, then creates the account with it", async () => {
    await continueWithWebsite(EMPTY, form(" acme.io ")).catch(
      (error: unknown) => {
        if (!String(error).includes("NEXT_REDIRECT")) throw error;
      },
    );

    expect(cookieJar.get(KEPT_WEBSITE_COOKIE)).toEqual({
      value: "https://acme.io/",
      options: KEPT_WEBSITE_OPTIONS,
    });
    const params = signInSocial.mock.lastCall?.[0].body.additionalParams;
    expect(params?.prompt).toBe("create");
    expect(JSON.parse(params?.signup_context)).toEqual({
      url: "https://acme.io/",
    });
    expect(redirectMock).toHaveBeenCalledWith("https://core.example/authorize");
  });

  it("asks again for a website it cannot read, without signing in", async () => {
    const state = await continueWithWebsite(EMPTY, form("not a site"));

    expect(state).toEqual({
      attempt: 1,
      websiteUrl: "not a site",
      errors: { websiteUrl: "Enter a website, like acme.com." },
    });
    expect(cookieJar.size).toBe(0);
    expect(signInSocial).not.toHaveBeenCalled();
  });

  it("keeps the website when sign in cannot start", async () => {
    signInSocial.mockRejectedValue(new TypeError("fetch failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await continueWithWebsite(EMPTY, form("acme.io")).catch(
      (error: unknown) => {
        if (!String(error).includes("NEXT_REDIRECT")) throw error;
      },
    );

    expect(cookieJar.get(KEPT_WEBSITE_COOKIE)?.value).toBe("https://acme.io/");
    expect(redirectMock).toHaveBeenCalledWith("/?error=unavailable");
  });
});
