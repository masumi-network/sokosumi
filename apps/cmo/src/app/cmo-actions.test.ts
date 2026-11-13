import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cmoOverview } from "../test-fixtures/cmo";

const startCmoOnboarding = vi.fn();
const listCmoCusos = vi.fn();
const listCmoPlans = vi.fn();
const getContactLists = vi.fn();
const postContactLists = vi.fn();
const postContactListsByIdImport = vi.fn();
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
    "answerCmoBrandBrainQuestionForProject",
    "answerCmoMarketingStrategyQuestionForProject",
    "applyCmoPlanAnswersForProject",
    "approveCmoMarketingStrategyForProject",
    "chooseCmoAdAccountForProject",
    "confirmCmoBrandBrainForProject",
    "connectCmoAdsForProject",
    "connectCmoMeasurementForProject",
    "finalizeCmoAdsForProject",
    "finalizeCmoMeasurementForProject",
    "finalizeCmoSocialConnectionForProject",
    "getCmoCalendarEntryTextForProject",
    "initiateCmoSocialConnectionForProject",
    "launchCmoSearchAdForProject",
    "listCmoAdCampaignsForProject",
    "listCmoAdChoicesForProject",
    "pauseCmoCalendarEntryForProject",
    "requestCmoStrategyForProject",
    "retryCmoOnboardingForProject",
    "revertCmoUpdateForProject",
    "setCmoAdBudgetForProject",
    "setCmoAdCampaignStatusForProject",
    "startCmoPlanCheckoutForProject",
    "startCmoTopUpForProject",
    "updateCmoBrandBrainForProject",
  ].map((name) => [name, vi.fn()]),
);

/** The standard chat and bot routes a Cuso action calls, by name. */
const standardRoutes = Object.fromEntries(
  [
    "completeSokoBotIntegrationAuth",
    "getChatsRoomsByIdMessages",
    "postChatsRoomsByIdMessages",
    "postComposioCallbackComplete",
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
  }),
}));

vi.mock("../lib/core", () => ({
  coreForCurrentUser: async () => ({
    client: {},
    headers: { authorization: "Bearer t" },
  }),
}));

vi.mock("@sokosumi/core-client", () => ({
  listCmoPlans,
  startCmoOnboarding,
  listCmoCusos,
  getContactLists,
  postContactLists,
  postContactListsByIdImport,
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
  loadCusos,
  loadOverview,
  onboard,
  skipBrandQuestions,
  skippedSteps,
  startOver,
  loadPlans,
  startPlanCheckout,
  startTopUp,
} = await import("./cmo-actions");

const cmoBrandBrain = cmoOverview().brandBrain;
if (!cmoBrandBrain) throw new Error("The fixture has a Brand Brain");

const EMPTY = { attempt: 0, websiteUrl: "", errors: {} };

function form(websiteUrl: string, organizationId?: string) {
  const data = new FormData();
  data.set("websiteUrl", websiteUrl);
  if (organizationId !== undefined) data.set("organizationId", organizationId);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  startCmoOnboarding.mockResolvedValue({
    data: { data: { projectId: "project-9" } },
    error: undefined,
  });
});

describe("onboard", () => {
  it("hires Cuso into a new organization with only the website, normalized", async () => {
    await expect(onboard(EMPTY, form("acme.io", ""))).rejects.toThrow(
      "redirect",
    );

    expect(startCmoOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { websiteUrl: "https://acme.io/" },
      }),
    );
  });

  it("hires Cuso into the organization the person chose", async () => {
    await expect(onboard(EMPTY, form("acme.io", "org-team"))).rejects.toThrow(
      "redirect",
    );

    expect(startCmoOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { websiteUrl: "https://acme.io/", organizationId: "org-team" },
      }),
    );
  });

  it("opens the hired Cuso and remembers him on this device", async () => {
    await expect(onboard(EMPTY, form("acme.io"))).rejects.toThrow(
      "redirect /?project=project-9",
    );
    expect(setCookie).toHaveBeenCalledWith(
      "cmo-last-cuso",
      "project-9",
      expect.objectContaining({ httpOnly: true, maxAge: 60 * 60 * 24 * 365 }),
    );
  });

  it("keeps what was typed and names the website when it is not one", async () => {
    const state = await onboard(EMPTY, form("not a site"));

    expect(startCmoOnboarding).not.toHaveBeenCalled();
    expect(state).toEqual({
      attempt: 1,
      websiteUrl: "not a site",
      organizationId: "",
      errors: { websiteUrl: "Enter a website, like acme.com." },
    });
  });

  it("links to the unpaid Cuso when Core refuses a second unpaid hire", async () => {
    startCmoOnboarding.mockResolvedValue({
      error: {
        message: "Your Cuso for old.io is not subscribed yet.",
        kind: "cmo_unpaid_cuso",
        unpaidCuso: {
          projectId: "0196a000-0000-7000-8000-000000000001",
          businessName: "old.io",
        },
      },
    });
    const state = await onboard(EMPTY, form("acme.io", "org-team"));
    expect(state.errors.form).toContain("old.io");
    expect(state.unpaidCuso).toEqual({
      href: "/?project=0196a000-0000-7000-8000-000000000001",
      businessName: "old.io",
    });
    // The choice stays for the next try.
    expect(state.organizationId).toBe("org-team");
  });

  it.each([
    ["cmo_hire_not_allowed", "invite-only"],
    ["organization_seat_required", "Seat"],
    ["organization_limit_reached", "organization limit"],
    ["organization_membership_required", "no longer a member"],
  ])("names the reason when Core refuses with %s", async (kind, words) => {
    startCmoOnboarding.mockResolvedValue({
      error: { message: "Forbidden", kind },
    });
    const state = await onboard(EMPTY, form("acme.io", "org-team"));
    expect(state.errors.form).toContain(words);
    expect(state.unpaidCuso).toBeUndefined();
  });

  it("says so when Core refuses for another reason, keeping the answers", async () => {
    startCmoOnboarding.mockResolvedValue({ error: { message: "nope" } });

    const state = await onboard(EMPTY, form("acme.io"));

    expect(state.errors).toEqual({ form: "That did not work. Try again." });
    expect(state.websiteUrl).toBe("acme.io");
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("loadCusos", () => {
  it("lists the person's Cusos as Core orders them", async () => {
    listCmoCusos.mockResolvedValue({
      data: {
        data: {
          cusos: [{ projectId: "project-2" }, { projectId: "project-1" }],
          mayHire: false,
        },
      },
      response: { status: 200 },
    });
    expect(await loadCusos()).toEqual({
      cusos: [{ projectId: "project-2" }, { projectId: "project-1" }],
      mayHire: false,
    });
  });

  it("fails when Core cannot list them", async () => {
    listCmoCusos.mockResolvedValue({ response: { status: 500 } });
    await expect(loadCusos()).rejects.toThrow();
  });
});

describe("social accounts", () => {
  // CMO's own route names Cuso's Project; no workspace header.
  const projectCall = {
    path: { projectId: "project-1" },
    headers: { authorization: "Bearer t" },
  };

  beforeEach(() => {
    getCmoOverviewForProject.mockResolvedValue({
      data: { data: { projectId: "project-1", organizationSlug: "acme" } },
      response: { status: 200 },
    });
  });

  it("connects through Cuso's Project and comes back to CMO", async () => {
    forProject.initiateCmoSocialConnectionForProject.mockResolvedValue({
      data: { data: { redirectUrl: "https://connect.example/x" } },
    });

    expect(await connectChannel("project-1", "x")).toEqual({
      url: "https://connect.example/x",
      error: null,
    });
    expect(
      forProject.initiateCmoSocialConnectionForProject,
    ).toHaveBeenCalledWith(
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
    forProject.initiateCmoSocialConnectionForProject.mockResolvedValue({
      data: { data: { redirectUrl: "https://connect.example/x" } },
    });

    await connectSetupChannel("project-1", "x");
    expect(
      forProject.initiateCmoSocialConnectionForProject,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          callbackUrl:
            "https://app.cmo.xyz/connect/callback?from=onboarding&project=project-1",
        }),
      }),
    );
  });

  it("finishes the connection on Cuso's Project", async () => {
    forProject.finalizeCmoSocialConnectionForProject.mockResolvedValue({
      data: {},
    });

    expect(await finalizeChannel("project-1", "ca_1")).toBe(true);
    expect(
      forProject.finalizeCmoSocialConnectionForProject,
    ).toHaveBeenCalledWith(
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
      data: {
        data: {
          projectId: "project-1",
          onboardingStep: "accounts",
          billing: { hiredWithStarterCredits: false, status: null },
        },
      },
      response: { status: 200 },
    };
    getCmoOverviewForProject.mockResolvedValue(overview);
  });

  it("resumes on Core's step without CMO's cookie", async () => {
    expect((await loadOverview("project-1"))?.onboardingStep).toBe("accounts");
  });

  it("resumes past the steps CMO's cookie skipped for this Cuso", async () => {
    cookieJar.set("cmo-skipped-project-1", "accounts");
    // Past the accounts the checkout is owed (ADR 0068).
    expect((await loadOverview("project-1"))?.onboardingStep).toBe("checkout");
    // Another Cuso's choices do not count.
    cookieJar.clear();
    cookieJar.set("cmo-skipped-project-2", "accounts");
    expect((await loadOverview("project-1"))?.onboardingStep).toBe("accounts");
  });

  it("moves on from the accounts step, kept in an httpOnly cookie", async () => {
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
  it("archives the Cuso on screen, then opens the hire form", async () => {
    startCmoOverForProject.mockResolvedValue({
      data: { data: { startedOver: true } },
    });
    listCmoCusos.mockResolvedValue({
      data: { data: { cusos: [], mayHire: true } },
    });
    await expect(startOver("project-2")).rejects.toThrow("redirect /");
    expect(redirect).toHaveBeenCalledWith("/?hire=1");
    expect(startCmoOverForProject).toHaveBeenCalledWith(
      expect.objectContaining({ path: { projectId: "project-2" } }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("opens the Cusos left instead for a person who may not hire", async () => {
    startCmoOverForProject.mockResolvedValue({
      data: { data: { startedOver: true } },
    });
    listCmoCusos.mockResolvedValue({
      data: { data: { cusos: [], mayHire: false } },
    });
    // The picker shows the invite-only page when none are left.
    await expect(startOver("project-2")).rejects.toThrow("redirect /");
    expect(redirect).toHaveBeenCalledWith("/?cusos=1");
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
  // The person also works with project-1 in acme; the page shows project-2.
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
    // Every action reads the Cuso on screen.
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
    [
      "approveStrategy",
      () => approveStrategy("project-2"),
      "approveCmoMarketingStrategyForProject",
      { strategyId: "strategy-2" },
    ],
    [
      "approveStrategy with a version",
      () => approveStrategy("project-2", "strategy-1"),
      "approveCmoMarketingStrategyForProject",
      { strategyId: "strategy-1" },
    ],
    [
      "approveBrandBrain",
      () => approveBrandBrain("project-2"),
      "confirmCmoBrandBrainForProject",
    ],
    [
      "answerBrandQuestion",
      () => answerBrandQuestion("project-2", brief),
      "answerCmoBrandBrainQuestionForProject",
    ],
    [
      "answerPlanQuestion",
      () => answerPlanQuestion("project-2", brief),
      "answerCmoMarketingStrategyQuestionForProject",
      { strategyId: "strategy-2" },
    ],
    [
      "saveBrandBrain",
      () => saveBrandBrain("project-2", cmoBrandBrain),
      "updateCmoBrandBrainForProject",
    ],
  ];

  it.each(cmoRoutes)(
    "%s acts on the Project on screen",
    async (_name, act, route, path = {}) => {
      await act();
      expect(forProject[route]).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { authorization: "Bearer t" },
          path: { projectId: "project-2", ...path },
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
    forProject.initiateCmoSocialConnectionForProject.mockResolvedValue({
      data: { data: { redirectUrl: "https://connect.example/x" } },
    });
    forProject.finalizeCmoSocialConnectionForProject.mockResolvedValue({
      data: {},
    });
    await connectChannel("project-2", "x");
    expect(await finalizeChannel("project-2", "ca_1", "s_1")).toBe(true);
    expect(
      forProject.initiateCmoSocialConnectionForProject,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { projectId: "project-2" },
        body: expect.objectContaining({
          callbackUrl:
            "https://app.cmo.xyz/connect/callback?from=app&project=project-2",
        }),
      }),
    );
    expect(standardRoutes.postComposioCallbackComplete).toHaveBeenCalledWith(
      expect.objectContaining({ ...inBeta }),
    );
    expect(
      forProject.finalizeCmoSocialConnectionForProject,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { projectId: "project-2" },
        body: { connectionId: "ca_1" },
      }),
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

  describe("the CMO plan checkout", () => {
    it("starts Polar's checkout for the Project, coming back to its confirming step, or to the plans without paying", async () => {
      forProject.startCmoPlanCheckoutForProject?.mockResolvedValue({
        data: { data: { url: "https://polar.sh/checkout/c_1" } },
      });
      expect(await startPlanCheckout("project-2", "year", "growth")).toEqual({
        url: "https://polar.sh/checkout/c_1",
        error: null,
      });
      expect(forProject.startCmoPlanCheckoutForProject).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { projectId: "project-2" },
          body: {
            interval: "year",
            tier: "growth",
            returnUrl: "https://app.cmo.xyz/?project=project-2&step=subscribed",
            backUrl: "https://app.cmo.xyz/?project=project-2",
          },
        }),
      );
    });

    it("hands Core's refusal back as text", async () => {
      forProject.startCmoPlanCheckoutForProject?.mockResolvedValue({
        error: { message: "This Cuso already has a CMO subscription" },
      });
      expect(await startPlanCheckout("project-2", "month", "starter")).toEqual({
        url: null,
        error: "This Cuso already has a CMO subscription",
      });
    });

    it("lists the plans, and none when Core cannot read them", async () => {
      listCmoPlans.mockResolvedValueOnce({
        data: { data: [{ tier: "growth" }] },
      });
      expect(await loadPlans()).toEqual([{ tier: "growth" }]);
      listCmoPlans.mockResolvedValueOnce({
        error: { message: "Polar is not configured" },
      });
      expect(await loadPlans()).toEqual([]);
    });
  });

  it("starts a top-up checkout for the named Cuso and comes back to him", async () => {
    forProject.startCmoTopUpForProject.mockResolvedValue({
      data: { data: { url: "https://polar.example/checkout/1" } },
    });

    const result = await startTopUp("project-2");

    expect(result).toEqual({
      url: "https://polar.example/checkout/1",
      error: null,
    });
    expect(forProject.startCmoTopUpForProject).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { projectId: "project-2" },
        body: { returnUrl: "https://app.cmo.xyz/?project=project-2" },
      }),
    );
  });

  it("says why a top-up checkout could not start", async () => {
    forProject.startCmoTopUpForProject.mockResolvedValue({
      error: { message: "A top-up needs an active CMO subscription" },
    });

    expect(await startTopUp("project-2")).toEqual({
      url: null,
      error: "A top-up needs an active CMO subscription",
    });
  });
});
