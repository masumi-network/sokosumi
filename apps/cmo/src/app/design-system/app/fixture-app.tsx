"use client";

import { CmoApp, type CmoAppActions } from "../../../components/app/cmo-app";
import type { View } from "../../../lib/views";
import { messages, overview } from "./fixtures";

/** Actions that change nothing: every call hands the same overview back. */
const actions: CmoAppActions = {
  // The same data every time, so the app's polling never changes the screen.
  loadState: async () => ({ overview, messages }),
  sendMessage: async () => {},
  loadPieceText: async (id) =>
    overview.strategy?.calendar.find((entry) => entry.id === id)?.draft ?? null,
  approveStrategy: async () => overview,
  setAdBudget: async () => ({ overview, error: null }),
  revertUpdate: async () => overview,
  saveBrandBrain: async () => overview,
  retryLearning: async () => ({ overview, error: null }),
  pauseEntry: async () => overview,
  connectChannel: async () => ({ url: null, error: null }),
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
  signOut: async () => {},
};

/** The signed-in app on one page, over fixture data, for looking at without Core. */
interface FixtureAppProps {
  view: View;
}

export function FixtureApp({ view }: FixtureAppProps) {
  return (
    <CmoApp
      overview={overview}
      messages={messages}
      name="Francis Luz"
      email="francis@acme.io"
      initialView={view}
      actions={actions}
    />
  );
}
