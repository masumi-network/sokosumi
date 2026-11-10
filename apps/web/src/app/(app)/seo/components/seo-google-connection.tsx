"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SeoConnectionButton } from "./seo-connection-button";
import {
  type SeoConnectionProvider,
  useSeoConnectionStatus,
} from "./use-seo-connection";

type GoogleConnectionProps = {
  /** The view's one primary action passes "primary"; it goes to the first action shown. */
  variant?: "primary" | "outline";
  /** Runs after an approval, with the source that was approved. */
  onConnected: (provider: SeoConnectionProvider) => void;
  /**
   * Opens the property choice and the sync, with Search Console chosen. With
   * it, a connected Search Console account has the sync button on a row above
   * the accounts. A view that has its own sync step leaves it out.
   */
  onSync?: (provider: SeoConnectionProvider) => void;
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
  const t = useTranslations("App.Seo");
  const search = useSeoConnectionStatus("search_console").status.data?.status;
  const ga4 = useSeoConnectionStatus("ga4").status.data?.status;
  const searchDone = search === "connected";
  // A Google Analytics account that is connected, or waits for a repair, has its own row.
  const analyticsStarted =
    ga4 !== undefined && ga4 !== "not_connected" && ga4 !== "unavailable";
  const sync = searchDone && onSync;
  const searchButton = (
    <SeoConnectionButton
      provider="search_console"
      // The sync is the first action once the account is connected.
      variant={sync ? "outline" : variant}
      // Beside a Google Analytics account, the button names the source that is missing.
      connectLabel={
        analyticsStarted ? undefined : t("connections.connectGoogle")
      }
      onConnected={() => onConnected("search_console")}
    />
  );
  const analyticsButton = (
    <SeoConnectionButton
      provider="ga4"
      onConnected={() => onConnected("ga4")}
    />
  );
  // A Google Analytics account that exists has its row before Search Console is done too.
  const analyticsShown = searchDone || analyticsStarted;
  // No status yet, a failed read, or no connections here: the button says all there is to say.
  // An unread Google Analytics status is not "not connected": its button says what it is.
  const note =
    !search || search === "unavailable" || analyticsStarted
      ? null
      : !searchDone
        ? "connections.analyticsNext"
        : ga4 === "not_connected"
          ? "connections.analyticsOff"
          : null;
  // One tree shape in every state: a status that changes during an approval
  // must not remount the control that runs it. One control under the other,
  // so every left edge is the same.
  return (
    <div className="flex max-w-full min-w-0 flex-col items-start gap-3">
      {sync ? (
        <Button
          type="button"
          variant={variant}
          size="sm"
          onClick={() => onSync("search_console")}
        >
          <RefreshCw />
          {t("syncStatistics")}
        </Button>
      ) : null}
      <div className="flex max-w-full min-w-0 flex-col items-start gap-2">
        {searchButton}
        {/* The second approval is on offer once the first one is done. */}
        {analyticsShown ? analyticsButton : null}
        {note ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t(note)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
