import { beforeEach, describe, expect, it, vi } from "vitest";

const signInSocial = vi.fn();
const signOutApi = vi.fn();
const redirectMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("../lib/auth", () => ({
  getAuth: () => ({
    api: { signInSocial, signOut: signOutApi },
  }),
}));

const { createAccount, signIn, signOut } = await import("./actions");

function promptSent(): string | undefined {
  return signInSocial.mock.lastCall?.[0].body.additionalParams?.prompt;
}

describe("CMO sign-in actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInSocial.mockResolvedValue({ url: "https://core.example/authorize" });
  });

  it("signs in without a prompt", async () => {
    await signIn();

    expect(promptSent()).toBeUndefined();
    expect(redirectMock).toHaveBeenCalledWith("https://core.example/authorize");
  });

  it("signs in without a prompt after signing out", async () => {
    // Sign in hands back to whoever is signed in to Sokosumi; switching
    // accounts goes through Create account's "Use another account".
    await signOut();
    await signIn();

    expect(promptSent()).toBeUndefined();
  });

  it("creates an account with the create prompt, even after signing out", async () => {
    await signOut();
    await createAccount();

    expect(promptSent()).toBe("create");
  });
});
