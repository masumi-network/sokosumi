import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cmoOverview } from "../test-fixtures/cmo";

const startCmoOnboarding = vi.fn();
const getCmoOverview = vi.fn();
const getContactLists = vi.fn();
const postContactLists = vi.fn();
const postContactListsByIdImport = vi.fn();
const postProjectsByIdSocialConnectionsInitiate = vi.fn();
const postProjectsByIdSocialConnectionsFinalize = vi.fn();
const getCmoOverviewForProject = vi.fn();
const startCmoOverForProject = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((to: string) => {
  throw new Error(`redirect ${to}`);
});
const cookieJar = new Map<string, string>();
const setCookie = vi.fn((name: string, value: string) => {
  cookieJar.set(name, value);
});

/** The …ForProject operations a Cuso action calls, by name. */
const forProject = Object.fromEntries(
  [
    "applyCmoPlanAnswersForProject",
    "chooseCmoAdAccountForProject",
    "connectCmoAdsForProject",
    "connectCmoMeasurementForProject",
    "finalizeCmoAdsForProject",
    "finalizeCmoMeasurementForProject",
    "getCmoCalendarEntryTextForProject",
    "launchCmoSearchAdForProject",
    "listCmoAdCampaignsForProject",
    "listCmoAdChoicesForProject",
    "pauseCmoCalendarEntryForProject",
    "requestCmoStrategyForProject",
    "retryCmoOnboardingForProject",
    "revertCmoUpdateForProject",
    "setCmoAdBudgetForProject",
    "setCmoAdCampaignStatusForProject",
  ].map((name) => [name, vi.fn()]),
);

/** The standard Project, chat and bot routes a Cuso action calls, by name. */
const standardRoutes = Object.fromEntries(
  [
    "answerProjectBrandBrainQuestion",
    "answerProjectMarketingStrategyQuestion",
    "approveProjectMarketingStrategy",
    "completeSokoBotIntegrationAuth",
    "confirmProjectBrandBrain",
    "getChatsRoomsByIdMessages",
    "postChatsRoomsByIdMessages",
    "postComposioCallbackComplete",
    "updateProjectBrandBrain",
  ].map((name) => [name, vi.fn()]),
);

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ host: "app.cmo.xyz", "x-forwarded-proto": "https" }),
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
    set: setCookie,
    delete: (name: string) => cookieJar.delete(name),
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
  getContactLists,
  postContactLists,
  postContactListsByIdImport,
  postProjectsByIdSocialConnectionsInitiate,
  postProjectsByIdSocialConnectionsFinalize,
  getCmoOverviewForProject,
  startCmoOverForProject,
  ...forProject,
  ...standardRoutes,
}));

const {
  addMailingList,
  answerBrandQuestion,
  answerPlanQuestion,
  applyPlanAnswers,
  approveBrandBrain,
  approveStrategy,
  chooseAdAccount,
  connectAds,
  connectMeasurement,
  finalizeAds,
  finalizeMeasurement,
  launchAd,
  loadAdCampaigns,
  loadAdChoices,
  loadMessages,
  loadPieceText,
  loadState,
  pauseEntry,
  requestStrategy,
  retryLearning,
  revertUpdate,
  saveBrandBrain,
  sendMessage,
  setAdBudget,
  setAdCampaignStatus,
  connectChannel,
  connectSetupChannel,
  finalizeChannel,
  finishAccounts,
  loadOverview,
  onboard,
  skipBrandQuestions,
  skippedSteps,
  startOver,
} = await import("./cmo-actions");

const cmoBrandBrain = cmoOverview().brandBrain;
if (!cmoBrandBrain) throw new Error("The fixture has a Brand Brain");

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

  it("forgets the website kept through sign in once reading starts", async () => {
    cookieJar.set("cmo-website", "https://acme.io/");

    await onboard(EMPTY, form("acme.io"));

    expect(cookieJar.has("cmo-website")).toBe(false);
  });

  it("forgets the kept website even when Core refuses, so a reload cannot hire twice", async () => {
    cookieJar.set("cmo-website", "https://acme.io/");
    startCmoOnboarding.mockResolvedValue({ error: { message: "nope" } });

    const state = await onboard(EMPTY, form("acme.io"));

    expect(cookieJar.has("cmo-website")).toBe(false);
    // The form keeps what was typed, so Start again is one press.
    expect(state.websiteUrl).toBe("acme.io");
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
    getCmoOverviewForProject.mockResolvedValue({
      data: { data: { projectId: "project-1", organizationSlug: "acme" } },
      response: { status: 200 },
    });
  });

  it("connects through Cuso's Project and comes back to CMO", async () => {
    postProjectsByIdSocialConnectionsInitiate.mockResolvedValue({
      data: { data: { redirectUrl: "https://connect.example/x" } },
    });

    expect(await connectChannel("project-1", "x")).toEqual({
      url: "https://connect.example/x",
      error: null,
    });
    expect(postProjectsByIdSocialConnectionsInitiate).toHaveBeenCalledWith(
      expect.objectContaining({
        ...projectCall,
        body: {
          action: "connect",
          provider: "x",
          callbackUrl:
            "https://app.cmo.xyz/connect/callback?from=app&project=project-1",
        },
      }),
    );
  });

  it("brings a connect on the Accounts step back to it", async () => {
    postProjectsByIdSocialConnectionsInitiate.mockResolvedValue({
      data: { data: { redirectUrl: "https://connect.example/x" } },
    });

    await connectSetupChannel("project-1", "x");
    expect(postProjectsByIdSocialConnectionsInitiate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          callbackUrl:
            "https://app.cmo.xyz/connect/callback?from=onboarding&project=project-1",
        }),
      }),
    );
  });

  it("ends a connect in a popup on the page that tells the opener", async () => {
    postProjectsByIdSocialConnectionsInitiate.mockResolvedValue({
      data: { data: { redirectUrl: "https://connect.example/x" } },
    });

    await connectSetupChannel("x", "popup");
    expect(postProjectsByIdSocialConnectionsInitiate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          callbackUrl: "https://app.cmo.xyz/connect/callback?from=popup",
        }),
      }),
    );
  });

  it("finishes the connection on Cuso's Project", async () => {
    postProjectsByIdSocialConnectionsFinalize.mockResolvedValue({ data: {} });

    expect(await finalizeChannel("project-1", "ca_1")).toBe(true);
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
    getCmoOverviewForProject.mockResolvedValue({
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

    const result = await addMailingList("project-1", "ada@example.com");

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

    await addMailingList("project-1", "ada@example.com");

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

    expect(await addMailingList("project-1", "nothing")).toEqual({
      overview: null,
      error: "No email addresses found in that text",
    });
  });
});

describe("skipped hiring steps", () => {
  beforeEach(() => {
    const overview = {
      data: { data: { projectId: "project-1", onboardingStep: "accounts" } },
      response: { status: 200 },
    };
    getCmoOverview.mockResolvedValue(overview);
    getCmoOverviewForProject.mockResolvedValue(overview);
  });

  it("resumes on Core's step without CMO's cookie", async () => {
    expect((await loadOverview())?.onboardingStep).toBe("accounts");
  });

  it("resumes past the steps CMO's cookie skipped for this Cuso", async () => {
    cookieJar.set("cmo-skipped-project-1", "accounts");
    expect((await loadOverview())?.onboardingStep).toBe("done");
    // Another Cuso's choices do not count.
    cookieJar.clear();
    cookieJar.set("cmo-skipped-project-2", "accounts");
    expect((await loadOverview())?.onboardingStep).toBe("accounts");
  });

  it("opens the app on Continue from the accounts step, kept in an httpOnly cookie", async () => {
    await finishAccounts("project-1").catch(() => undefined);
    expect(redirect).toHaveBeenCalledWith("/?project=project-1");
    expect(setCookie).toHaveBeenCalledWith(
      "cmo-skipped-project-1",
      "accounts",
      expect.objectContaining({ httpOnly: true, maxAge: 60 * 60 * 24 * 365 }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});

describe("skipped brand questions", () => {
  beforeEach(() => {
    getCmoOverviewForProject.mockResolvedValue({
      data: { data: { projectId: "project-1", onboardingStep: "brandBrain" } },
      response: { status: 200 },
    });
  });

  it("keeps the skip in the cookie beside the accounts, without moving Core's step", async () => {
    cookieJar.set("cmo-skipped-project-1", "accounts");
    const overview = await skipBrandQuestions("project-1");
    expect(overview.onboardingStep).toBe("brandBrain");
    expect(setCookie).toHaveBeenCalledWith(
      "cmo-skipped-project-1",
      "accounts,questions",
      expect.objectContaining({ httpOnly: true }),
    );
    cookieJar.set("cmo-skipped-project-1", "accounts,questions");
    expect(await skippedSteps("project-1")).toEqual(["accounts", "questions"]);
  });
});

describe("start over", () => {
  it("archives the Cuso on screen, then opens the Project Core selected", async () => {
    startCmoOverForProject.mockResolvedValue({
      data: { data: { startedOver: true, projectId: "project-3" } },
    });
    await expect(startOver("project-2")).rejects.toThrow("redirect /");
    expect(redirect).toHaveBeenCalledWith("/?project=project-3");
    expect(startCmoOverForProject).toHaveBeenCalledWith(
      expect.objectContaining({ path: { projectId: "project-2" } }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("opens the hiring form when no Cuso is left", async () => {
    startCmoOverForProject.mockResolvedValue({
      data: { data: { startedOver: true, projectId: null } },
    });
    await expect(startOver("project-2")).rejects.toThrow("redirect /");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("forgets a kept website, so the hiring form does not start on its own", async () => {
    cookieJar.set("cmo-website", "https://acme.io/");
    startCmoOverForProject.mockResolvedValue({
      data: { data: { startedOver: true, projectId: null } },
    });

    await expect(startOver("project-2")).rejects.toThrow("redirect /");

    expect(cookieJar.has("cmo-website")).toBe(false);
  });

  it("says why when Core refuses", async () => {
    startCmoOverForProject.mockResolvedValue({
      error: { message: "Only an organization owner or admin can archive" },
    });
    expect(await startOver("project-2")).toBe(
      "Only an organization owner or admin can archive",
    );
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("the Cuso on screen", () => {
  // The person's default Cuso is project-1 in acme; the page shows project-2.
  const onScreen = {
    projectId: "project-2",
    organizationSlug: "beta",
    sokoBotId: "bot-2",
    roomId: "room-2",
    strategyVersion: { id: "strategy-2" },
  };
  const inBeta = {
    headers: { authorization: "Bearer t", "x-organization-slug": "beta" },
  };

  beforeEach(() => {
    getCmoOverview.mockResolvedValue({
      data: { data: { ...onScreen, projectId: "project-1" } },
      response: { status: 200 },
    });
    getCmoOverviewForProject.mockImplementation(async ({ path }) => ({
      data: { data: { ...onScreen, projectId: path.projectId } },
      response: { status: 200 },
    }));
    for (const route of [
      ...Object.values(forProject),
      ...Object.values(standardRoutes),
    ]) {
      route.mockResolvedValue({
        data: { data: { ...onScreen, redirectUrl: "https://p.example" } },
      });
    }
  });

  afterEach(() => {
    // No action falls back to the default Cuso.
    expect(getCmoOverview).not.toHaveBeenCalled();
    for (const call of getCmoOverviewForProject.mock.calls) {
      expect(call[0].path).toEqual({ projectId: "project-2" });
    }
  });

  const brief = { questionId: "q1", answer: "yes" as const };
  const cmoRoutes: [string, () => Promise<unknown>, string, object?][] = [
    [
      "requestStrategy",
      () => requestStrategy("project-2", "more"),
      "requestCmoStrategyForProject",
    ],
    [
      "setAdBudget",
      () => setAdBudget("project-2", 500, "EUR"),
      "setCmoAdBudgetForProject",
    ],
    [
      "applyPlanAnswers",
      () => applyPlanAnswers("project-2"),
      "applyCmoPlanAnswersForProject",
    ],
    [
      "retryLearning",
      () => retryLearning("project-2"),
      "retryCmoOnboardingForProject",
    ],
    [
      "pauseEntry",
      () => pauseEntry("project-2", "e1"),
      "pauseCmoCalendarEntryForProject",
      { id: "e1" },
    ],
    [
      "loadPieceText",
      () => loadPieceText("project-2", "e1"),
      "getCmoCalendarEntryTextForProject",
      { id: "e1" },
    ],
    [
      "revertUpdate",
      () => revertUpdate("project-2", "u1"),
      "revertCmoUpdateForProject",
      { id: "u1" },
    ],
    [
      "connectAds",
      () => connectAds("project-2", "google_ads", "app"),
      "connectCmoAdsForProject",
      { provider: "google_ads" },
    ],
    [
      "finalizeAds",
      () => finalizeAds("project-2", "ca_1", null),
      "finalizeCmoAdsForProject",
    ],
    [
      "loadAdChoices",
      () => loadAdChoices("project-2", "ad-1"),
      "listCmoAdChoicesForProject",
      { adConnectionId: "ad-1" },
    ],
    [
      "chooseAdAccount",
      () => chooseAdAccount("project-2", "ad-1", "123"),
      "chooseCmoAdAccountForProject",
    ],
    [
      "loadAdCampaigns",
      () => loadAdCampaigns("project-2", "LAST_7_DAYS"),
      "listCmoAdCampaignsForProject",
    ],
    [
      "launchAd",
      () => launchAd("project-2", "e1"),
      "launchCmoSearchAdForProject",
    ],
    [
      "setAdCampaignStatus",
      () =>
        setAdCampaignStatus("project-2", {
          accountId: "a",
          campaignId: "c",
          status: "PAUSED",
        }),
      "setCmoAdCampaignStatusForProject",
    ],
    [
      "connectMeasurement",
      () => connectMeasurement("project-2", "shopify", "app"),
      "connectCmoMeasurementForProject",
      { provider: "shopify" },
    ],
    [
      "finalizeMeasurement",
      () => finalizeMeasurement("project-2", "shopify", null),
      "finalizeCmoMeasurementForProject",
      { provider: "shopify" },
    ],
  ];

  it.each(cmoRoutes)(
    "%s acts on the Project on screen",
    async (_name, act, route, path = {}) => {
      await act();
      expect(forProject[route]).toHaveBeenCalledWith(
        expect.objectContaining({ path: { projectId: "project-2", ...path } }),
      );
    },
  );

  const projectRoutes: [string, () => Promise<unknown>, string][] = [
    [
      "approveStrategy",
      () => approveStrategy("project-2"),
      "approveProjectMarketingStrategy",
    ],
    [
      "approveBrandBrain",
      () => approveBrandBrain("project-2"),
      "confirmProjectBrandBrain",
    ],
    [
      "answerBrandQuestion",
      () => answerBrandQuestion("project-2", brief),
      "answerProjectBrandBrainQuestion",
    ],
    [
      "answerPlanQuestion",
      () => answerPlanQuestion("project-2", brief),
      "answerProjectMarketingStrategyQuestion",
    ],
    [
      "saveBrandBrain",
      () => saveBrandBrain("project-2", cmoBrandBrain),
      "updateProjectBrandBrain",
    ],
  ];

  it.each(projectRoutes)(
    "%s uses the Project route of the Project on screen",
    async (_name, act, route) => {
      await act();
      expect(standardRoutes[route]).toHaveBeenCalledWith(
        expect.objectContaining({
          ...inBeta,
          path: expect.objectContaining({ id: "project-2" }),
        }),
      );
    },
  );

  it("reads and writes the chat of the Cuso on screen", async () => {
    const chatInBeta = {
      headers: { authorization: "Bearer t", "X-Organization-Slug": "beta" },
    };
    standardRoutes.getChatsRoomsByIdMessages.mockResolvedValue({
      data: { data: [] },
    });
    await loadState("project-2");
    await loadMessages("project-2");
    await sendMessage("project-2", "hi");
    expect(standardRoutes.getChatsRoomsByIdMessages).toHaveBeenCalledTimes(2);
    expect(standardRoutes.getChatsRoomsByIdMessages).toHaveBeenCalledWith(
      expect.objectContaining({ ...chatInBeta, path: { id: "room-2" } }),
    );
    expect(standardRoutes.postChatsRoomsByIdMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        ...chatInBeta,
        path: { id: "room-2" },
        body: { content: "hi", mentionedSokoBotIds: ["bot-2"] },
      }),
    );
  });

  it("finishes a measurement session on the bot of the Cuso on screen", async () => {
    await finalizeMeasurement("project-2", "shopify", "s_1");
    expect(standardRoutes.completeSokoBotIntegrationAuth).toHaveBeenCalledWith(
      expect.objectContaining({ ...inBeta, path: { sokoBotId: "bot-2" } }),
    );
  });

  it("connects and finishes a network on the Project on screen", async () => {
    postProjectsByIdSocialConnectionsInitiate.mockResolvedValue({
      data: { data: { redirectUrl: "https://connect.example/x" } },
    });
    postProjectsByIdSocialConnectionsFinalize.mockResolvedValue({ data: {} });
    await connectChannel("project-2", "x");
    expect(await finalizeChannel("project-2", "ca_1", "s_1")).toBe(true);
    expect(postProjectsByIdSocialConnectionsInitiate).toHaveBeenCalledWith(
      expect.objectContaining({
        ...inBeta,
        path: { id: "project-2" },
        body: expect.objectContaining({
          callbackUrl:
            "https://app.cmo.xyz/connect/callback?from=app&project=project-2",
        }),
      }),
    );
    expect(standardRoutes.postComposioCallbackComplete).toHaveBeenCalledWith(
      expect.objectContaining({ ...inBeta }),
    );
    expect(postProjectsByIdSocialConnectionsFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ ...inBeta, path: { id: "project-2" } }),
    );
  });

  it("sends the provider back with the Project it started from", async () => {
    await connectAds("project-2", "meta_ads", "onboarding");
    await connectMeasurement("project-2", "google_analytics", "app");
    expect(forProject.connectCmoAdsForProject).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          returnUrl:
            "https://app.cmo.xyz/ads/callback?from=onboarding&project=project-2",
        },
      }),
    );
    expect(forProject.connectCmoMeasurementForProject).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          returnUrl:
            "https://app.cmo.xyz/measure/callback?provider=google_analytics&from=app&project=project-2",
        },
      }),
    );
  });
});
