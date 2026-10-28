import { beforeEach, describe, expect, it, vi } from "vitest";

const startCmoOnboarding = vi.fn();
const getCmoOverview = vi.fn();
const postProjectsByIdSocialConnectionsInitiate = vi.fn();
const postProjectsByIdSocialConnectionsFinalize = vi.fn();
const getContactLists = vi.fn();
const postContactLists = vi.fn();
const postContactListsByIdImport = vi.fn();
const revalidatePath = vi.fn();
const cookieJar = new Map<string, string>();
const setCookie = vi.fn((name: string, value: string) => {
  cookieJar.set(name, value);
});

vi.mock("next/cache", () => ({ revalidatePath }));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ host: "app.cmo.xyz", "x-forwarded-proto": "https" }),
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
    set: setCookie,
  }),
}));

vi.mock("../lib/core", () => ({
  coreForCurrentUser: async () => ({
    client: {},
    headers: { authorization: "Bearer t" },
  }),
}));

vi.mock("@sokosumi/core-client", () => ({
  startCmoOnboarding,
  getCmoOverview,
  postProjectsByIdSocialConnectionsInitiate,
  postProjectsByIdSocialConnectionsFinalize,
  getContactLists,
  postContactLists,
  postContactListsByIdImport,
}));

const {
  addMailingList,
  connectChannel,
  finalizeChannel,
  finishAccounts,
  loadOverview,
  onboard,
  subscribeLater,
} = await import("./cmo-actions");

const EMPTY = { attempt: 0, websiteUrl: "", errors: {} };

function form(websiteUrl: string) {
  const data = new FormData();
  data.set("websiteUrl", websiteUrl);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  startCmoOnboarding.mockResolvedValue({ data: {}, error: undefined });
});

describe("onboard", () => {
  it("hires Cuso with only the website, normalized", async () => {
    await onboard(EMPTY, form("acme.io"));

    expect(startCmoOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { websiteUrl: "https://acme.io/" },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("keeps what was typed and names the website when it is not one", async () => {
    const state = await onboard(EMPTY, form("not a site"));

    expect(startCmoOnboarding).not.toHaveBeenCalled();
    expect(state).toEqual({
      attempt: 1,
      websiteUrl: "not a site",
      errors: { websiteUrl: "Enter a website, like acme.com." },
    });
  });

  it("links to top up when Core refuses for credits", async () => {
    startCmoOnboarding.mockResolvedValue({
      error: { message: "You're out of credits" },
    });
    const state = await onboard(EMPTY, form("acme.io"));
    expect(state.errors.form).toContain("out of credits");
    expect(state.topUpUrl).toMatch(/\/billing$/);
  });

  it("says so when Core refuses, keeping the answers", async () => {
    startCmoOnboarding.mockResolvedValue({ error: { message: "nope" } });

    const state = await onboard(EMPTY, form("acme.io"));

    expect(state.errors).toEqual({ form: "That did not work. Try again." });
    expect(state.websiteUrl).toBe("acme.io");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("social accounts", () => {
  // Cuso's Project in an organization: the Project routes need its slug.
  const projectCall = {
    path: { id: "project-1" },
    headers: { authorization: "Bearer t", "x-organization-slug": "acme" },
  };

  beforeEach(() => {
    getCmoOverview.mockResolvedValue({
      data: { data: { projectId: "project-1", organizationSlug: "acme" } },
      response: { status: 200 },
    });
  });

  it("connects through Cuso's Project and comes back to CMO", async () => {
    postProjectsByIdSocialConnectionsInitiate.mockResolvedValue({
      data: { data: { redirectUrl: "https://connect.example/x" } },
    });

    expect(await connectChannel("x")).toEqual({
      url: "https://connect.example/x",
      error: null,
    });
    expect(postProjectsByIdSocialConnectionsInitiate).toHaveBeenCalledWith(
      expect.objectContaining({
        ...projectCall,
        body: {
          action: "connect",
          provider: "x",
          callbackUrl: "https://app.cmo.xyz/connect/callback",
        },
      }),
    );
  });

  it("finishes the connection on Cuso's Project", async () => {
    postProjectsByIdSocialConnectionsFinalize.mockResolvedValue({ data: {} });

    expect(await finalizeChannel("ca_1")).toBe(true);
    expect(postProjectsByIdSocialConnectionsFinalize).toHaveBeenCalledWith(
      expect.objectContaining({
        ...projectCall,
        body: { connectionId: "ca_1" },
      }),
    );
  });
});

describe("addMailingList", () => {
  const inWorkspace = {
    headers: { authorization: "Bearer t", "x-organization-slug": "acme" },
  };

  beforeEach(() => {
    getCmoOverview.mockResolvedValue({
      data: { data: { projectId: "project-1", organizationSlug: "acme" } },
      response: { status: 200 },
    });
    postContactListsByIdImport.mockResolvedValue({ data: { data: {} } });
  });

  it("imports into the workspace's Newsletter list", async () => {
    getContactLists.mockResolvedValue({
      data: {
        data: [
          { id: "list-0", name: "VIP", kind: "manual" },
          { id: "list-1", name: "newsletter", kind: "manual" },
        ],
      },
    });

    const result = await addMailingList("ada@example.com");

    expect(result.error).toBeNull();
    expect(postContactLists).not.toHaveBeenCalled();
    expect(postContactListsByIdImport).toHaveBeenCalledWith(
      expect.objectContaining({
        ...inWorkspace,
        path: { id: "list-1" },
        body: { text: "ada@example.com" },
      }),
    );
  });

  it("creates the Newsletter list the first time", async () => {
    getContactLists.mockResolvedValue({ data: { data: [] } });
    postContactLists.mockResolvedValue({ data: { data: { id: "list-9" } } });

    await addMailingList("ada@example.com");

    expect(postContactLists).toHaveBeenCalledWith(
      expect.objectContaining({
        ...inWorkspace,
        body: { name: "Newsletter", color: "blue" },
      }),
    );
    expect(postContactListsByIdImport).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: "list-9" } }),
    );
  });

  it("passes Core's refusal on", async () => {
    getContactLists.mockResolvedValue({
      data: { data: [{ id: "list-1", name: "Newsletter", kind: "manual" }] },
    });
    postContactListsByIdImport.mockResolvedValue({
      error: { message: "No email addresses found in that text" },
    });

    expect(await addMailingList("nothing")).toEqual({
      overview: null,
      error: "No email addresses found in that text",
    });
  });
});

describe("skipped hiring steps", () => {
  beforeEach(() => {
    getCmoOverview.mockResolvedValue({
      data: { data: { projectId: "project-1", onboardingStep: "accounts" } },
      response: { status: 200 },
    });
  });

  it("resumes on Core's step without CMO's cookie", async () => {
    expect((await loadOverview())?.onboardingStep).toBe("accounts");
  });

  it("resumes past the steps CMO's cookie skipped for this Cuso", async () => {
    cookieJar.set("cmo-skipped-project-1", "accounts");
    expect((await loadOverview())?.onboardingStep).toBe("plan");
    // Another Cuso's choices do not count.
    cookieJar.clear();
    cookieJar.set("cmo-skipped-project-2", "accounts,plan");
    expect((await loadOverview())?.onboardingStep).toBe("accounts");
  });

  it("remembers Continue on the accounts step in an httpOnly cookie", async () => {
    expect((await finishAccounts()).onboardingStep).toBe("plan");
    expect(setCookie).toHaveBeenCalledWith(
      "cmo-skipped-project-1",
      "accounts",
      expect.objectContaining({ httpOnly: true, maxAge: 60 * 60 * 24 * 365 }),
    );
  });

  it("remembers Subscribe later beside the skipped accounts", async () => {
    cookieJar.set("cmo-skipped-project-1", "accounts");
    await subscribeLater();
    expect(cookieJar.get("cmo-skipped-project-1")).toBe("accounts,plan");
    expect((await loadOverview())?.onboardingStep).toBe("done");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});
