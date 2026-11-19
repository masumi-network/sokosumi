"use client";

import { CmoApp, type CmoAppActions } from "../../../components/app/cmo-app";
import type { View } from "../../../lib/views";
import { cmoPlans } from "../../../test-fixtures/cmo";
import { competitors, noCompetitors } from "./competitors-fixture";
import { chat, messages, overview, seo } from "./fixtures";

/** Actions that change nothing: every call hands the same overview back. */
const actions: CmoAppActions = {
  // The same data every time, so the app's polling never changes the screen.
  loadState: async () => ({ overview, messages }),
  loadChatWork: async () => [],
  loadChatWorkText: async () =>
    "## Three trends\n\n- Loyalty passes replace one-off drops\n- Brands mint on their own site\n- Buyers pay by card",
  loadChatWorkTable: async () => ({
    columns: ["Post", "Channel", "Status"],
    rows: Array.from({ length: 12 }, (_, index) => [
      `Launch post ${index + 1}`,
      index % 2 ? "LinkedIn" : "X",
      index < 4 ? "Made" : "Planned",
    ]),
    total: 12,
  }),
  sendMessage: async () => {},
  skipSubscription: async () => ({ error: null }),
  loadPieceText: async (id) =>
    overview.strategy?.calendar.find((entry) => entry.id === id)?.draft ?? null,
  approveStrategy: async () => overview,
  setAdBudget: async () => ({ overview, error: null }),
  revertUpdate: async () => overview,
  saveBrandBrain: async () => overview,
  retryLearning: async () => ({ overview, error: null }),
  pauseEntry: async () => overview,
  approveDraft: async () => ({ overview, error: null }),
  declineDraft: async () => ({ overview, error: null }),
  editDraft: async () => ({ overview, error: null }),
  competitors: {
    loadCompetitors: async () => competitors,
    addCompetitor: async () => ({ competitors, error: null }),
    updateCompetitor: async () => ({ competitors, error: null }),
    removeCompetitor: async () => ({ competitors, error: null }),
    addMoveToStrategy: async () => ({ competitors, error: null }),
  },
  connectChannel: async () => ({ url: null, error: null }),
  addMailingList: async () => ({ overview, error: null }),
  connectMeasurement: async () => ({ url: null, error: null }),
  connectAds: async () => ({ url: null, error: null }),
  launchAd: async () => ({ overview, error: null }),
  setAdCampaignStatus: async () => ({ overview, error: null }),
  loadAdCampaigns: async () => [
    {
      account: {
        id: "acc-1",
        name: "Acme Ads",
        provider: "google_ads",
        currency: "EUR",
      },
      campaigns: [
        {
          id: "camp-1",
          name: "Acme trial, search",
          status: "ACTIVE",
          objective: null,
          dailyBudget: 7,
          spend: 48.2,
          impressions: 5200,
          clicks: 140,
          ctr: 0.027,
          cpc: 0.34,
          conversions: 6,
        },
      ],
      failed: false,
    },
  ],
  // Both would leave the preview.
  startOver: async () => null,
  setTimeZone: async () => null,
  startTopUp: async () => ({ url: null, error: null }),
  subscribe: async () => ({ url: null, error: null }),
  changePlan: async () => ({ change: null, error: null }),
  openPortal: async () => ({ url: null, error: null }),
  signOut: async () => {},
  loadSeo: async () => seo,
  searchKeywords: async () => ({
    search: seo.keywordSearches[0] ?? null,
    error: null,
  }),
  setSeoSuggestionStatus: async () => null,
  markLandingPageLive: async () => ({ note: null, error: null }),
  askCusoForArticles: async () => null,
};

/** The signed-in app on one page, over fixture data, for looking at without Core. */
interface FixtureAppProps {
  view: View;
  /** Competitors: the page with nobody watched yet, or still loading. */
  state?: "empty" | "loading";
}

export function FixtureApp({ view, state }: FixtureAppProps) {
  const data = view === "chat" ? chat : { overview, messages };
  const loadCompetitors =
    state === "loading"
      ? () => new Promise<null>(() => {})
      : async () => (state === "empty" ? noCompetitors : competitors);
  return (
    <CmoApp
      overview={data.overview}
      messages={data.messages}
      work={view === "chat" ? chat.work : []}
      name="Francis Luz"
      email="francis@acme.io"
      initialView={view}
      plans={cmoPlans}
      actions={{
        ...actions,
        loadState: async () => data,
        loadChatWork: async () => (view === "chat" ? chat.work : []),
        competitors: { ...actions.competitors, loadCompetitors },
      }}
    />
  );
}
