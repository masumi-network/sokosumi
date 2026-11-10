"use client";

import { useTranslations } from "next-intl";
import { SeoConnectionButton } from "./seo-connection-button";
import {
  type SeoConnectionProvider,
  useSeoConnectionStatus,
} from "./use-seo-connection";

type GoogleConnectionProps = {
  /** The view's one primary action passes "primary"; it goes to the Search Console button. */
  variant?: "primary" | "outline";
  /** Runs after an approval, with the source that was approved. */
  onConnected: (provider: SeoConnectionProvider) => void;
  /** Opens the property choice and the sync of one source. */
  onSync: (provider: SeoConnectionProvider) => void;
};

/**
 * One Google step for the two statistics sources. Each source has its own
 * Google approval, so Search Console comes first and Google Analytics follows.
 * The user leaves Google Analytics out in the approval window, not here.
 */
export function SeoGoogleConnection({
  variant = "outline",
  onConnected,
  onSync,
}: GoogleConnectionProps) {
  const t = useTranslations("App.Seo.connections");
  const search = useSeoConnectionStatus("search_console").status.data?.status;
  const ga4 = useSeoConnectionStatus("ga4").status.data?.status;
  // A Google Analytics account that is connected, or waits for a repair, has its own row.
  const analyticsStarted =
    ga4 !== undefined && ga4 !== "not_connected" && ga4 !== "unavailable";
  const searchButton = (
    <SeoConnectionButton
      provider="search_console"
      variant={variant}
      // Beside a Google Analytics account, the button names the source that is missing.
      connectLabel={analyticsStarted ? undefined : t("connectGoogle")}
      onConnected={() => onConnected("search_console")}
      onSync={() => onSync("search_console")}
    />
  );
  const analyticsButton = (
    <SeoConnectionButton
      provider="ga4"
      onConnected={() => onConnected("ga4")}
      onSync={() => onSync("ga4")}
    />
  );
  if (analyticsStarted)
    return (
      <div className="max-w-full min-w-0 space-y-3">
        {searchButton}
        {analyticsButton}
      </div>
    );
  // No status yet, a failed read, or no connections here: that button says all there is to say.
  if (!search || search === "unavailable") return searchButton;
  const searchDone = search === "connected";
  return (
    <div className="max-w-full min-w-0 space-y-3">
      {searchButton}
      {/* The second approval is on offer once the first one is done. */}
      {searchDone ? analyticsButton : null}
      {/* An unread Google Analytics status is not "not connected": its button says what it is. */}
      {searchDone && ga4 !== "not_connected" ? null : (
        <p role="status" className="text-muted-foreground text-sm">
          {t(searchDone ? "analyticsOff" : "analyticsNext")}
        </p>
      )}
    </div>
  );
}
