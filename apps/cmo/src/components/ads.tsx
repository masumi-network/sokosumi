"use client";

import type { CmoAdCampaigns, CmoOverview } from "@sokosumi/core-client";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

type Entry = NonNullable<CmoOverview["strategy"]>["calendar"][number];
type AdAccounts = CmoAdCampaigns["accounts"];
type AdProvider = "google_ads" | "meta_ads";

/** What CMO's server does for ads (Sokosumi's Ads beta). */
export interface AdActions {
  connectAds: (
    provider: AdProvider,
    from: "onboarding" | "app",
  ) => Promise<{ url: string | null; error: string | null }>;
  launchAd: (
    entryId: string,
  ) => Promise<{ overview: CmoOverview | null; error: string | null }>;
  setAdCampaignStatus: (input: {
    accountId: string;
    campaignId: string;
    status: "ACTIVE" | "PAUSED";
  }) => Promise<{ overview: CmoOverview | null; error: string | null }>;
  loadAdCampaigns: (
    range: "LAST_7_DAYS" | "LAST_30_DAYS",
  ) => Promise<AdAccounts>;
}

/** Why an ad connection came back without an account, from the return address. */
export function adsReturnError(): string | null {
  if (typeof window === "undefined") return null;
  const ads = new URLSearchParams(window.location.search).get("ads");
  if (ads === "none") {
    return "That login has no ad account. Create one in Google Ads or Meta, then connect again.";
  }
  return ads === "failed"
    ? "That ad connection didn't finish. Try again."
    : null;
}

/** Starts connecting Google Ads or Meta Ads; the browser goes to their sign-in. */
export function ConnectAdsButton({
  provider,
  from,
  connectAds,
  quiet = true,
}: {
  provider: AdProvider;
  from: "onboarding" | "app";
  connectAds: AdActions["connectAds"];
  quiet?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="ads-actions">
      <button
        type="button"
        className={quiet ? "ob-button ob-button-quiet" : "ob-button"}
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const result = await connectAds(provider, from).catch(() => ({
            url: null,
            error: "Could not start connecting. Try again.",
          }));
          if (result.url) {
            window.location.assign(result.url);
            return;
          }
          setPending(false);
          setError(
            result.error && /configured|not set up/i.test(result.error)
              ? "Connecting ad accounts isn't available here yet."
              : result.error,
          );
        }}
      >
        {pending ? (
          <Loader2 size={14} className="ob-spin" aria-hidden="true" />
        ) : null}
        Connect
      </button>
      {error ? (
        <span className="ob-note" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A search ad Cuso wrote, in the piece sheet: its keywords and headlines, and
 * Launch for an owner once a Google Ads account is connected. Launching spends
 * money, within the plan's ad budget.
 */
export function SearchAdControl({
  entry,
  overview,
  actions,
  onChange,
}: {
  entry: Entry;
  overview: CmoOverview;
  actions: Pick<AdActions, "launchAd" | "setAdCampaignStatus">;
  onChange: (overview: CmoOverview) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ad = entry.searchAd;
  if (!ad) return null;
  const googleConnected = overview.adProviders.includes("google_ads");

  async function run(
    change: () => Promise<{
      overview: CmoOverview | null;
      error: string | null;
    }>,
  ) {
    setPending(true);
    setError(null);
    const result = await change().catch(() => ({
      overview: null,
      error: "That didn't go through. Try again.",
    }));
    setPending(false);
    if (result.overview) onChange(result.overview);
    setError(result.error);
  }

  return (
    <div className="ads-panel">
      <p className="ob-label">Search ad</p>
      <p className="note">Keywords: {ad.keywords.join(", ")}</p>
      <p className="note">Headlines: {ad.headlines.join(" · ")}</p>
      <p className="note">Sends people to {ad.finalUrl}</p>
      {!overview.viewerCanApprove ? (
        <p className="note">An owner or admin launches ads.</p>
      ) : !googleConnected ? (
        <p className="note">Connect Google Ads in Channels to launch it.</p>
      ) : entry.adCampaign ? (
        <div className="ads-actions">
          <span className="note">Launched in Google Ads.</span>
          <button
            type="button"
            className="ob-button ob-button-quiet"
            disabled={pending}
            onClick={() => {
              const launched = entry.adCampaign;
              if (!launched) return;
              void run(() =>
                actions.setAdCampaignStatus({ ...launched, status: "PAUSED" }),
              );
            }}
          >
            Pause
          </button>
          <button
            type="button"
            className="ob-button ob-button-quiet"
            disabled={pending}
            onClick={() => void run(() => actions.launchAd(entry.id))}
          >
            Start again
          </button>
        </div>
      ) : (
        <div className="ads-actions">
          <button
            type="button"
            className="ob-button"
            disabled={pending}
            onClick={() => void run(() => actions.launchAd(entry.id))}
          >
            {pending ? (
              <Loader2 size={14} className="ob-spin" aria-hidden="true" />
            ) : null}
            Launch ad
          </button>
          <span className="note">
            Starts spending from your plan's ad budget.
          </span>
        </div>
      )}
      {error ? (
        <p className="ob-note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** The ad accounts' campaigns with last week's numbers, for Results. */
export function AdsPanel({
  overview,
  actions,
  onChange,
}: {
  overview: CmoOverview;
  actions: Pick<AdActions, "loadAdCampaigns" | "setAdCampaignStatus">;
  onChange: (overview: CmoOverview) => void;
}) {
  const [accounts, setAccounts] = useState<AdAccounts | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connected = overview.adProviders.length > 0;
  const { loadAdCampaigns } = actions;

  useEffect(() => {
    if (!connected) return;
    let current = true;
    loadAdCampaigns("LAST_7_DAYS")
      .then((loaded) => {
        if (current) setAccounts(loaded);
      })
      .catch(() => {
        if (current) setAccounts([]);
      });
    return () => {
      current = false;
    };
  }, [connected, loadAdCampaigns]);

  return (
    <section className="panel">
      <h3>Ads</h3>
      {!connected ? (
        <p className="muted">
          Connect Google Ads or Meta Ads in Channels and their numbers show
          here.
        </p>
      ) : accounts === null ? (
        <p className="muted">Reading your ad accounts…</p>
      ) : accounts.every((account) => account.failed) ? null : accounts.every(
          (account) => account.campaigns.length === 0,
        ) ? (
        <p className="muted">
          No campaigns yet. Launch one of Cuso's search ads from Strategy.
        </p>
      ) : (
        <ul className="list">
          {accounts.flatMap(({ account, campaigns }) =>
            campaigns.map((campaign) => (
              <li key={`${account.id}-${campaign.id}`} className="li">
                <span className="grow">
                  <b>{campaign.name}</b>
                  <br />
                  <span className="note num">
                    {money(campaign.spend, account.currency)} spent ·{" "}
                    {campaign.clicks} clicks
                    {campaign.conversions === null
                      ? ""
                      : ` · ${campaign.conversions} conversions`}{" "}
                    · last 7 days
                  </span>
                </span>
                <span className="tag">
                  {campaign.status === "ACTIVE" ? "Running" : "Paused"}
                </span>
                {campaign.status === "ACTIVE" ||
                campaign.status === "PAUSED" ? (
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    disabled={pending !== null || !overview.viewerCanApprove}
                    onClick={async () => {
                      setPending(campaign.id);
                      setError(null);
                      const result = await actions
                        .setAdCampaignStatus({
                          accountId: account.id,
                          campaignId: campaign.id,
                          status:
                            campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
                        })
                        .catch(() => ({
                          overview: null,
                          error: "That didn't go through. Try again.",
                        }));
                      setPending(null);
                      setError(result.error);
                      if (result.overview) {
                        onChange(result.overview);
                        setAccounts(await loadAdCampaigns("LAST_7_DAYS"));
                      }
                    }}
                  >
                    {campaign.status === "ACTIVE" ? "Pause" : "Start"}
                  </button>
                ) : null}
              </li>
            )),
          )}
        </ul>
      )}
      {accounts?.some((account) => account.failed) ? (
        <p className="note">
          An ad account didn't answer. Its campaigns show again once it does.
        </p>
      ) : null}
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
