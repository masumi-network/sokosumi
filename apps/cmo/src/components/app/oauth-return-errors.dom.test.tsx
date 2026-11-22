// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cmoOverview } from "../../test-fixtures/cmo";
import { CmoApp, type CmoAppActions } from "./cmo-app";

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  if (root) {
    await act(() => root?.unmount());
    root = null;
  }
  host.remove();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

function stubActions(): CmoAppActions {
  const noop = async () => null;
  const noopConnect = async () => ({ url: null, error: null });
  const noopDraft = async () => ({ overview: null, error: null });
  const noopCompetitor = async () => ({ competitors: null, error: null });
  return {
    loadState: async () => ({ overview: null, messages: [] }),
    loadChatWork: async () => [],
    loadChatWorkText: noop,
    loadChatWorkTable: async () => null,
    sendMessage: async () => {},
    loadPieceText: noop,
    loadSeo: async () => null,
    searchKeywords: async () => ({ search: null, error: null }),
    setSeoSuggestionStatus: noop,
    markLandingPageLive: async () => ({ note: null, error: null }),
    askCusoForArticles: noop,
    approveStrategy: async () => cmoOverview(),
    requestStrategy: async () => ({ overview: null, error: null }),
    setAdBudget: async () => ({ overview: null, error: null }),
    revertUpdate: async () => cmoOverview(),
    retryLearning: async () => ({ overview: cmoOverview(), error: null }),
    saveBrandBrain: async () => cmoOverview(),
    pauseEntry: async () => cmoOverview(),
    approveDraft: noopDraft,
    readTikTokCreator: async () => ({ creator: null, error: null }),
    declineDraft: noopDraft,
    editDraft: noopDraft,
    pictures: {
      loadPictures: async () => ({ groups: [], networks: [], months: [] }),
    },
    competitors: {
      loadCompetitors: async () => null,
      addCompetitor: noopCompetitor,
      updateCompetitor: noopCompetitor,
      removeCompetitor: noopCompetitor,
      addMoveToStrategy: noopCompetitor,
    },
    connectChannel: noopConnect,
    changeChannel: noopConnect,
    addMailingList: async () => ({ overview: null, error: null }),
    connectMeasurement: noopConnect,
    connectAds: noopConnect,
    launchAd: async () => ({ overview: null, error: null }),
    setAdCampaignStatus: async () => ({ overview: null, error: null }),
    loadAdCampaigns: async () => [],
    setTimeZone: noop,
    markUpgradeSeen: async () => undefined,
    startOver: noop,
    startTopUp: noopConnect,
    subscribe: noopConnect,
    skipSubscription: async () => ({ error: null }),
    changePlan: async () => ({ change: null, error: null }),
    openPortal: noopConnect,
    signOut: async () => {},
  };
}

describe("CMO OAuth return errors during hydration", () => {
  it.each([
    [
      "/channels?ads=failed&project=project-1",
      "That ad connection didn't finish. Try again.",
    ],
    [
      "/channels?ads=none&project=project-1",
      "That login has no ad account. Create one in Google Ads or Meta, then connect again.",
    ],
  ])(
    "keeps the Channels ads return error visible after hydration strips %s",
    async (url, expectedError) => {
      window.history.replaceState(null, "", url);
      const element = (
        <CmoApp
          overview={cmoOverview()}
          messages={[]}
          name="Ada"
          email="ada@example.com"
          initialView="channels"
          adsError={expectedError}
          actions={stubActions()}
        />
      );
      host.innerHTML = renderToString(element);

      await act(async () => {
        root = hydrateRoot(host, element);
      });

      expect(window.location.search).toBe("");
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        expectedError,
      );
    },
  );

  it("keeps the Results measurement return error visible after hydration strips /results?measure=failed", async () => {
    const expectedError = "That connection didn't finish. Try again.";
    window.history.replaceState(
      null,
      "",
      "/results?measure=failed&project=project-1",
    );
    const element = (
      <CmoApp
        overview={cmoOverview()}
        messages={[]}
        name="Ada"
        email="ada@example.com"
        initialView="results"
        measureError={expectedError}
        actions={stubActions()}
      />
    );
    host.innerHTML = renderToString(element);

    await act(async () => {
      root = hydrateRoot(host, element);
    });

    expect(window.location.search).toBe("");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      expectedError,
    );
  });

  it("clears Channels return notices after leaving Channels and returning on the clean URL", async () => {
    const expectedError = "That ad connection didn't finish. Try again.";
    window.history.replaceState(
      null,
      "",
      "/channels?ads=failed&project=project-1",
    );
    const element = (
      <CmoApp
        overview={cmoOverview()}
        messages={[]}
        name="Ada"
        email="ada@example.com"
        initialView="channels"
        connectError="That connection didn't finish. Try again."
        adsError={expectedError}
        actions={stubActions()}
      />
    );
    host.innerHTML = renderToString(element);

    await act(async () => {
      root = hydrateRoot(host, element);
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      expectedError,
    );

    const todayLink = host.querySelector<HTMLAnchorElement>(
      'nav[aria-label="Main"] a[href="/"]',
    );
    expect(todayLink).not.toBeNull();

    await act(async () => {
      todayLink?.click();
    });
    expect(window.location.pathname).toBe("/");

    // Channels opens from the brand's menu at the head of the sidebar.
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          'nav[aria-label="Main"] .brand-button',
        )
        ?.click();
    });
    const channelsLink = host.querySelector<HTMLAnchorElement>(
      'nav[aria-label="Main"] [role="menu"] a[href="/channels"]',
    );
    expect(channelsLink).not.toBeNull();
    await act(async () => {
      channelsLink?.click();
    });
    expect(window.location.pathname).toBe("/channels");
    expect(window.location.search).toBe("");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("clears Results measurement error after leaving Results and returning on the clean URL", async () => {
    const expectedError = "That connection didn't finish. Try again.";
    window.history.replaceState(
      null,
      "",
      "/results?measure=failed&project=project-1",
    );
    const element = (
      <CmoApp
        overview={cmoOverview()}
        messages={[]}
        name="Ada"
        email="ada@example.com"
        initialView="results"
        measureError={expectedError}
        actions={stubActions()}
      />
    );
    host.innerHTML = renderToString(element);

    await act(async () => {
      root = hydrateRoot(host, element);
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      expectedError,
    );

    const todayLink = host.querySelector<HTMLAnchorElement>(
      'nav[aria-label="Main"] a[href="/"]',
    );
    const resultsLink = host.querySelector<HTMLAnchorElement>(
      'nav[aria-label="Main"] a[href="/results"]',
    );
    expect(todayLink).not.toBeNull();
    expect(resultsLink).not.toBeNull();

    await act(async () => {
      todayLink?.click();
    });
    expect(window.location.pathname).toBe("/");

    await act(async () => {
      resultsLink?.click();
    });
    expect(window.location.pathname).toBe("/results");
    expect(window.location.search).toBe("");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("measurement on Channels", () => {
  const notConnected = cmoOverview().measurement.map((source) => ({
    ...source,
    status: "none" as const,
  }));

  function connectButton(name: string): HTMLButtonElement {
    const row = [...host.querySelectorAll(".sc-sources li")].find((li) =>
      li.textContent?.includes(name),
    );
    const button = row?.querySelector("button");
    if (!button) throw new Error(`No Connect button for ${name}`);
    return button;
  }

  it("offers Google Analytics next to Search Console and starts one sign-in per press", async () => {
    const connectMeasurement = vi.fn(
      () => new Promise<{ url: string | null; error: string | null }>(() => {}),
    );
    await act(async () => {
      root = createRoot(host);
      root.render(
        <CmoApp
          overview={cmoOverview({ measurement: notConnected })}
          messages={[]}
          name="Ada"
          email="ada@example.com"
          initialView="channels"
          actions={{ ...stubActions(), connectMeasurement }}
        />,
      );
    });

    expect(connectButton("Google Analytics").textContent).toBe("Connect");
    await act(async () => {
      connectButton("Google Search Console").click();
    });
    await act(async () => {
      connectButton("Google Search Console").click();
      connectButton("Google Analytics").click();
    });

    expect(connectMeasurement).toHaveBeenCalledExactlyOnceWith(
      "google_search_console",
      "channels",
    );
  });

  it("offers Search Console in one place and opens SEO from it once connected", async () => {
    const render = async (status: "none" | "connected") => {
      const measurement = cmoOverview().measurement.map((source) =>
        source.provider === "google_search_console"
          ? { ...source, status }
          : source,
      );
      await act(async () => {
        root ??= createRoot(host);
        root.render(
          <CmoApp
            key={status}
            overview={cmoOverview({ measurement })}
            messages={[]}
            name="Ada"
            email="ada@example.com"
            initialView="channels"
            actions={stubActions()}
          />,
        );
      });
    };
    const openSeo = () =>
      [...host.querySelectorAll(".page-body a")].filter(
        (link) => link.textContent === "Open SEO",
      );

    await render("none");
    expect(host.textContent).not.toContain("No account to connect for SEO");
    expect(host.textContent?.match(/Google Search Console/g)).toHaveLength(1);
    expect(openSeo()).toHaveLength(0);

    await render("connected");
    const [link] = openSeo();
    expect(link?.getAttribute("href")).toBe("/seo");
    await act(async () => {
      (link as HTMLAnchorElement).click();
    });
    expect(window.location.pathname).toBe("/seo");
  });

  it("keeps the Channels measurement return error visible after hydration strips /channels?measure=failed", async () => {
    const expectedError = "That connection didn't finish. Try again.";
    window.history.replaceState(
      null,
      "",
      "/channels?measure=failed&project=project-1",
    );
    const element = (
      <CmoApp
        overview={cmoOverview()}
        messages={[]}
        name="Ada"
        email="ada@example.com"
        initialView="channels"
        measureError={expectedError}
        actions={stubActions()}
      />
    );
    host.innerHTML = renderToString(element);

    await act(async () => {
      root = hydrateRoot(host, element);
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      expectedError,
    );
  });
});
