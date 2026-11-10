import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CmoApp } from "../components/app/cmo-app";
import { CusoPicker } from "../components/cuso-picker";
import { InviteOnly } from "../components/invite-only";
import { NameSetup } from "../components/name-setup";
import { Onboarding } from "../components/onboarding";
import { SignedIn } from "../components/signed-in";

const getSession = vi.fn();
const getUsersById = vi.fn();
const getUsersByIdSignUp = vi.fn();
const getUsersByIdOrganizations = vi.fn();
const loadOverview = vi.fn();
const loadCusos = vi.fn();
const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
  }),
}));

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
  getUsersByIdOrganizations,
  getUsersByIdSignUp,
}));

vi.mock("./actions", () => ({ signIn: vi.fn(), signOut: vi.fn() }));

vi.mock("./name-actions", () => ({ saveName: vi.fn() }));

vi.mock("./cmo-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cmo-actions")>()),
  loadOverview,
  loadCusos,
  loadMessages: async () => [],
  skippedSteps: async () => [],
}));

const { default: HomePage } = await import("./page");

type Page = ReactElement<{
  websiteUrl?: string;
  organizations?: { id: string; name: string }[];
  cusos?: { projectId: string }[];
  mayHire?: boolean;
  overview?: { projectId: string };
}>;

function render(error?: string | string[]): Promise<Page> {
  return HomePage({ searchParams: Promise.resolve({ error }) });
}

function open(params: Record<string, string>): Promise<Page> {
  return HomePage({ searchParams: Promise.resolve(params) }) as Promise<Page>;
}

/** A hired Cuso as Core lists him, and his overview once opened. */
function cuso(projectId: string) {
  return {
    projectId,
    businessName: `${projectId}.io`,
    websiteUrl: `https://${projectId}.io`,
    projectLogo: null,
    organizationId: "org-1",
    organizationName: "Agency",
    hiring: false,
    createdAt: new Date(),
  };
}
const hired = (projectId: string) => ({ projectId, onboardingStep: "done" });

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
    getUsersByIdOrganizations.mockResolvedValue({
      data: { data: [] },
      response: new Response(null, { status: 200 }),
    });
    cookieJar.clear();
    // Not hired yet, and on the hire allowlist.
    loadCusos.mockResolvedValue({ cusos: [], mayHire: true });
    loadOverview.mockImplementation(async (projectId: string) =>
      ["project-1", "project-2", "project-3"].includes(projectId)
        ? hired(projectId)
        : null,
    );
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

  it("opens the Cuso the address names, over the one last opened", async () => {
    cookieJar.set("cmo-last-cuso", "project-1");
    const page = await open({ project: "project-2" });

    expect(page.type).toBe(CmoApp);
    expect(page.props.overview?.projectId).toBe("project-2");
    expect(loadOverview).toHaveBeenCalledExactlyOnceWith("project-2");
    expect(loadCusos).not.toHaveBeenCalled();
  });

  it("opens the Cuso last opened on this device", async () => {
    cookieJar.set("cmo-last-cuso", "project-1");
    loadCusos.mockResolvedValue({
      cusos: [cuso("project-2"), cuso("project-1")],
      mayHire: true,
    });

    const page = await render();

    expect(page.props.overview?.projectId).toBe("project-1");
    expect(loadCusos).not.toHaveBeenCalled();
  });

  it("opens the only Cuso directly, by an address this device remembers", async () => {
    loadCusos.mockResolvedValue({ cusos: [cuso("project-3")], mayHire: true });

    // The proxy writes the cookie for an address naming his Project.
    await expect(render()).rejects.toThrow("redirect /?project=project-3");
    expect(loadOverview).not.toHaveBeenCalled();
  });

  it("shows the Cuso picker for several Cusos and none opened here before", async () => {
    loadCusos.mockResolvedValue({
      cusos: [cuso("project-2"), cuso("project-1")],
      mayHire: true,
    });

    const page = await render();

    expect(page.type).toBe(CusoPicker);
    expect(page.props.cusos?.map((item) => item.projectId)).toEqual([
      "project-2",
      "project-1",
    ]);
  });

  it.each([
    ["a Project the person can no longer use", { project: "project-gone" }],
    ["a remembered Cuso that was archived", {}],
  ])("falls through to the picker from %s", async (_label, params) => {
    cookieJar.set("cmo-last-cuso", "project-gone");
    loadCusos.mockResolvedValue({
      cusos: [cuso("project-2"), cuso("project-1")],
      mayHire: true,
    });

    expect((await open(params)).type).toBe(CusoPicker);
  });

  it("shows the picker for an unavailable address even with a usable remembered Cuso", async () => {
    cookieJar.set("cmo-last-cuso", "project-1");
    loadCusos.mockResolvedValue({ cusos: [cuso("project-1")], mayHire: true });

    expect((await open({ project: "project-gone" })).type).toBe(CusoPicker);
    expect(loadOverview).toHaveBeenCalledExactlyOnceWith("project-gone");
  });

  it("falls through to the hire form from a Project the person can no longer use and no Cuso", async () => {
    expect((await open({ project: "project-gone" })).type).toBe(Onboarding);
  });

  it("shows the Cuso picker the account menu asks for, even for one Cuso", async () => {
    loadCusos.mockResolvedValue({ cusos: [cuso("project-3")], mayHire: true });

    expect((await open({ cusos: "1" })).type).toBe(CusoPicker);
  });

  it("opens the hire form after Start over, even when Cusos remain", async () => {
    cookieJar.set("cmo-last-cuso", "project-1");
    loadCusos.mockResolvedValue({ cusos: [cuso("project-1")], mayHire: true });

    const page = await open({ hire: "1" });

    expect(page.type).toBe(Onboarding);
    expect(loadOverview).not.toHaveBeenCalled();
  });

  describe("for a person not on the hire allowlist", () => {
    it("shows the invite-only page instead of the hire form when they have no Cuso", async () => {
      loadCusos.mockResolvedValue({ cusos: [], mayHire: false });

      expect((await render()).type).toBe(InviteOnly);
      expect(getUsersByIdOrganizations).not.toHaveBeenCalled();
    });

    it("still opens their Cuso", async () => {
      loadCusos.mockResolvedValue({
        cusos: [cuso("project-1")],
        mayHire: false,
      });

      await expect(render()).rejects.toThrow("redirect /?project=project-1");
      cookieJar.set("cmo-last-cuso", "project-1");
      expect((await render()).type).toBe(CmoApp);
    });

    it("shows the invite-only page for the hire form's address", async () => {
      loadCusos.mockResolvedValue({
        cusos: [cuso("project-1")],
        mayHire: false,
      });

      expect((await open({ hire: "1" })).type).toBe(InviteOnly);
    });

    it("shows the picker without hiring", async () => {
      loadCusos.mockResolvedValue({
        cusos: [cuso("project-1")],
        mayHire: false,
      });

      const page = await open({ cusos: "1" });
      expect(page.type).toBe(CusoPicker);
      expect(page.props.mayHire).toBe(false);
    });
  });

  it("asks where Cuso goes for a person with organizations", async () => {
    getUsersByIdOrganizations.mockResolvedValue({
      data: { data: [{ id: "org-1", name: "Agency", slug: "agency" }] },
      response: new Response(null, { status: 200 }),
    });

    const page = await render();

    expect(page.type).toBe(Onboarding);
    expect(page.props.organizations).toEqual([{ id: "org-1", name: "Agency" }]);
  });

  it("goes straight to hiring Cuso, with no workspace question", async () => {
    const page = await render();

    expect(page.type).toBe(Onboarding);
    expect(page.props.websiteUrl).toBeUndefined();
    expect(page.props.organizations).toEqual([]);
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

  it("keeps the signed-in shell when Core cannot list the Cusos", async () => {
    loadCusos.mockRejectedValue(new Error("down"));

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
