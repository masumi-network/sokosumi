import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
const signInSocial = vi.fn();
const signOutApi = vi.fn();
const redirectMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    has: (name: string) => cookieJar.has(name),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
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
    cookieJar.clear();
    vi.clearAllMocks();
    signInSocial.mockResolvedValue({ url: "https://core.example/authorize" });
  });

  it("signs in without a prompt", async () => {
    await signIn();

    expect(promptSent()).toBeUndefined();
    expect(redirectMock).toHaveBeenCalledWith("https://core.example/authorize");
  });

  it("asks Sokosumi to sign in again on the first Sign in after signing out", async () => {
    // Sokosumi's own session outlives CMO's, so without the prompt the next
    // Sign in would land in the same account.
    await signOut();
    await signIn();

    expect(promptSent()).toBe("login");

    // Only a sign-in that completes forgets the sign-out (auth.ts), so an
    // abandoned attempt asks again.
    await signIn();

    expect(promptSent()).toBe("login");
  });

  it("creates an account with the create prompt, even after signing out", async () => {
    await signOut();
    await createAccount();

    expect(promptSent()).toBe("create");
  });
});
