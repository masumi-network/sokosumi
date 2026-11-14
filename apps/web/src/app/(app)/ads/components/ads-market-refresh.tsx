"use client";

import type { AdMarketProfile } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, use, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** Long enough for the slowest refresh seen; then the page asks once more. */
export const MARKET_REFRESH_WAIT_MS = 30_000;

interface MarketRefresh {
  /** The saved profile while the page still shows the one before it. */
  pending: AdMarketProfile | null;
  /** Called with Core's saved profile once a save succeeds. */
  saved: (profile: AdMarketProfile) => void;
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
 * as the saved one, the save is pending. A refresh that never lands stops
 * waiting after `MARKET_REFRESH_WAIT_MS` and asks the page again.
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
  const [saved, setSaved] = useState<AdMarketProfile | null>(null);
  const pending =
    saved &&
    (shownUpdatedAt === null || time(shownUpdatedAt) < time(saved.updatedAt))
      ? saved
      : null;

  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => {
      setSaved(null);
      router.refresh();
    }, MARKET_REFRESH_WAIT_MS);
    return () => clearTimeout(id);
  }, [pending, router]);

  return (
    <MarketRefreshContext value={{ pending, saved: setSaved }}>
      {children}
    </MarketRefreshContext>
  );
}

/**
 * The market's results while a save is pending: dimmed and busy, under a line
 * that says they are being updated. The status region is always there, so the
 * line is announced when it appears.
 */
export function AdsMarketUpdating({ children }: { children: ReactNode }) {
  const t = useTranslations("App.Ads.market");
  const updating = useMarketRefresh()?.pending != null;

  return (
    <div className="flex flex-col">
      <div
        className={cn("text-muted-foreground text-sm", updating && "mb-4")}
        role="status"
      >
        {updating ? (
          <>
            <p>{t("updating")}</p>
            <div
              aria-hidden
              className="text-foreground relative mt-2 h-0.5 overflow-hidden"
            >
              <span className="animate-button-loading-sweep absolute top-0 left-0 h-0 w-2/5 border-t-2 border-current motion-reduce:w-full motion-reduce:animate-pulse" />
            </div>
          </>
        ) : null}
      </div>
      <div
        aria-busy={updating}
        className={cn(
          "transition-opacity duration-200 motion-reduce:transition-none",
          updating && "opacity-50",
        )}
        data-testid="ads-market-results"
      >
        {children}
      </div>
    </div>
  );
}
