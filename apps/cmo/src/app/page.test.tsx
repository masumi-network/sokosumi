import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NameSetup } from "../components/name-setup";
import { Onboarding } from "../components/onboarding";
import { SignedIn } from "../components/signed-in";

const getSession = vi.fn();
const getUsersById = vi.fn();
const getUsersByIdSignUp = vi.fn();
const loadOverview = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

vi.mock("../lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));

vi.mock("../lib/core", () => ({
  asSignedInPersonInPage: async () => ({
    headers: { authorization: "Bearer token_123" },
  }),
}));

vi.mock("@sokosumi/core-client", () => ({
  getUsersById,
  getUsersByIdSignUp,
}));

vi.mock("./actions", () => ({ signIn: vi.fn(), signOut: vi.fn() }));

vi.mock("./name-actions", () => ({ saveName: vi.fn() }));

vi.mock("./cmo-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cmo-actions")>()),
  loadOverview,
}));

const { default: HomePage } = await import("./page");

function render(
  error?: string | string[],
): Promise<ReactElement<{ websiteUrl?: string }>> {
  return HomePage({ searchParams: Promise.resolve({ error }) });
}

function userAnswer(firstName: string | null, lastName: string | null) {
  return {
    data: { data: { id: "user_1", name: "Ada", firstName, lastName } },
    response: new Response(null, { status: 200 }),
  };
}

function signUpAnswer(origin: string, context: Record<string, unknown>) {
  return {
    data: { data: { origin, context, createdAt: new Date() } },
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
    getUsersByIdSignUp.mockResolvedValue({
      error: { error: "Not Found" },
      response: new Response(null, { status: 404 }),
    });
    // Not hired yet.
    loadOverview.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Without a session the proxy serves the waitlist site; what reaches the
  // page (an error, a stale cookie) goes to the unlinked /login.
  it("sends a visitor without a session to /login, without asking Core", async () => {
    getSession.mockResolvedValue(null);

    await expect(render()).rejects.toThrow("redirect /login");
    await expect(render("state_mismatch")).rejects.toThrow(
      "redirect /login?error=state_mismatch",
    );
    expect(getUsersById).not.toHaveBeenCalled();
  });

  it("goes straight to hiring Cuso, with no workspace question", async () => {
    const page = await render();

    expect(page.type).toBe(Onboarding);
    expect(page.props.websiteUrl).toBeUndefined();
    expect(getUsersById).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "me" },
        headers: { authorization: "Bearer token_123" },
      }),
    );
  });

  it("starts the hiring form with the website the CMO sign-up link carried", async () => {
    getUsersByIdSignUp.mockResolvedValue(
      signUpAnswer("cmo", { url: "nmkr.io", plan: "pro" }),
    );

    const page = await render();

    expect(page.type).toBe(Onboarding);
    expect(page.props.websiteUrl).toBe("nmkr.io");
  });

  it.each([
    ["another origin", signUpAnswer("sokosumi", { url: "nmkr.io" })],
    ["no url", signUpAnswer("cmo", { plan: "pro" })],
    ["a url that is not text", signUpAnswer("cmo", { url: 42 })],
  ])("starts the hiring form empty for %s", async (_label, answer) => {
    getUsersByIdSignUp.mockResolvedValue(answer);
    const consoleError = vi.spyOn(console, "error");

    const page = await render();

    expect(page.props.websiteUrl).toBeUndefined();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    ["answers 500", new Response(null, { status: 500 })],
    ["is unreachable", undefined],
  ])(
    "still shows the hiring form when Core %s for the sign-up",
    async (_label, response) => {
      getUsersByIdSignUp.mockResolvedValue({ error: {}, response });
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const page = await render();

      expect(page.type).toBe(Onboarding);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Core did not read the sign-up"),
      );
    },
  );

  it.each([
    ["no name parts", null, null],
    ["only a first name", "Ada", null],
    ["blank parts", " ", " "],
    ["a name too long to store", "A".repeat(64), "B".repeat(64)],
  ])(
    "asks a person with %s for their name before hiring",
    async (_label, firstName, lastName) => {
      getUsersById.mockResolvedValue(userAnswer(firstName, lastName));

      expect((await render()).type).toBe(NameSetup);
    },
  );

  it("keeps the signed-in shell when Core cannot load Cuso", async () => {
    loadOverview.mockRejectedValue(new Error("down"));

    expect((await render()).type).toBe(SignedIn);
  });

  it("fails into the error page when Core cannot read the person", async () => {
    getUsersById.mockResolvedValue({
      error: { error: "Internal Server Error" },
      response: new Response(null, { status: 500 }),
    });

    await expect(render()).rejects.toThrow("(500)");
  });

  it.each([401, 403])(
    "sends the person to /login when Core refuses the token (%i)",
    async (status) => {
      getUsersById.mockResolvedValue({
        error: { error: "Unauthorized" },
        response: new Response(null, { status }),
      });

      await expect(render()).rejects.toThrow(
        "redirect /login?error=signed_out",
      );
    },
  );
});
