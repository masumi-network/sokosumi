"use client";

import type { AdMarketProfile } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  startTransition,
  use,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { useTimeout } from "@/hooks/effects/use-timeout";
import { cn } from "@/lib/utils";

/** Long enough for the slowest refresh seen; then the page asks once more. */
export const MARKET_REFRESH_WAIT_MS = 30_000;

/**
 * How the results relate to the last save: current, being updated, or still
 * from before it once the wait ran out.
 */
type MarketResultsState = "current" | "updating" | "stale";

interface MarketRefresh {
  /** Core's last saved profile while the page still shows an older one. */
  saved: AdMarketProfile | null;
  results: MarketResultsState;
  /** Called with Core's saved profile once a save succeeds. */
  onSaved: (profile: AdMarketProfile) => void;
  /** Asks the page for the saved market's results again. */
  refresh: () => void;
}

const MarketRefreshContext = createContext<MarketRefresh | null>(null);

export function useMarketRefresh(): MarketRefresh | null {
  return use(MarketRefreshContext);
}

function time(updatedAt: AdMarketProfile["updatedAt"] | string): number {
  return new Date(updatedAt).getTime();
}

/**
 * Bridges a market save and the page catching up. A save returns before the
 * refreshed results render, so until the page shows a profile at least as new
 * as the saved one, the saved profile stands in for the summary and the
 * results are updating. At `MARKET_REFRESH_WAIT_MS` the page is asked once
 * more and the results turn stale, with a refresh by hand, until it catches
 * up. A refresh still in flight never hides that: it may never settle. A new
 * save starts a new wait. The saved profile is never dropped: Core confirmed
 * it.
 */
export function AdsMarketRefresh({
  children,
  shownUpdatedAt,
}: {
  children: ReactNode;
  /** The profile the page shows now; null before there is one. */
  shownUpdatedAt: AdMarketProfile["updatedAt"] | string | null;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState<AdMarketProfile | null>(null);
  const [waited, setWaited] = useState(false);
  const refresh = () => startTransition(() => router.refresh());
  const saved =
    confirmed &&
    (shownUpdatedAt === null ||
      time(shownUpdatedAt) < time(confirmed.updatedAt))
      ? confirmed
      : null;

  useTimeout(
    () => {
      setWaited(true);
      startTransition(() => router.refresh());
    },
    saved && !waited ? MARKET_REFRESH_WAIT_MS : null,
    saved,
  );

  const results: MarketResultsState = !saved
    ? "current"
    : waited
      ? "stale"
      : "updating";

  return (
    <MarketRefreshContext
      value={{
        saved,
        results,
        onSaved: (profile) => {
          setWaited(false);
          setConfirmed(profile);
        },
        refresh,
      }}
    >
      {children}
    </MarketRefreshContext>
  );
}

/**
 * The market's results after a save: dimmed and busy under an updating line
 * until the saved market's results arrive; dimmed under a stale line with a
 * Refresh button when they are late. The status region is always there, so
 * each line is announced when it appears.
 */
export function AdsMarketUpdating({ children }: { children: ReactNode }) {
  const t = useTranslations("App.Ads.market");
  const refresh = useMarketRefresh();
  const results = refresh?.results ?? "current";

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
          results !== "current" && "mb-4",
        )}
      >
        <div className="text-muted-foreground min-w-0 text-sm" role="status">
          {results === "updating" ? (
            <>
              <p>{t("updating")}</p>
              <div
                aria-hidden
                className="text-foreground relative mt-2 h-0.5 overflow-hidden"
              >
                <span className="animate-button-loading-sweep absolute top-0 left-0 h-0 w-2/5 border-t-2 border-current motion-reduce:w-full motion-reduce:animate-pulse" />
              </div>
            </>
          ) : results === "stale" ? (
            <p>{t("stale")}</p>
          ) : null}
        </div>
        {results === "stale" ? (
          <Button
            onClick={refresh?.refresh}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("refresh")}
          </Button>
        ) : null}
      </div>
      <div
        aria-busy={results === "updating"}
        className={cn(
          "transition-opacity duration-200 motion-reduce:transition-none",
          results !== "current" && "opacity-50",
        )}
        data-results={results}
        data-testid="ads-market-results"
      >
        {children}
      </div>
    </div>
  );
}
