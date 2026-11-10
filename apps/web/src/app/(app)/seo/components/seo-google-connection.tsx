"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
 * Google approval, so Search Console comes first and Google Analytics follows
 * as a second approval that the user can leave out.
 */
export function SeoGoogleConnection({
  variant = "outline",
  onConnected,
  onSync,
}: GoogleConnectionProps) {
  const t = useTranslations("App.Seo.connections");
  const [analytics, setAnalytics] = useState(true);
  const analyticsId = useId();
  const hintId = useId();
  const search = useSeoConnectionStatus("search_console").status.data?.status;
  const ga4 = useSeoConnectionStatus("ga4").status.data?.status;
  // A Google Analytics account that is connected, or waits for a repair, is no longer a choice.
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
  return (
    <div className="max-w-full min-w-0 space-y-3">
      {searchButton}
      {analytics && search === "connected" ? analyticsButton : null}
      <div className="flex items-start gap-2">
        <Checkbox
          id={analyticsId}
          checked={analytics}
          aria-describedby={
            analytics && search === "connected" ? undefined : hintId
          }
          onCheckedChange={(checked) => setAnalytics(checked === true)}
        />
        <Label htmlFor={analyticsId}>{t("includeAnalytics")}</Label>
      </div>
      {analytics && search === "connected" ? null : (
        <p id={hintId} role="status" className="text-muted-foreground text-sm">
          {t(analytics ? "analyticsNext" : "analyticsOff")}
        </p>
      )}
    </div>
  );
}
