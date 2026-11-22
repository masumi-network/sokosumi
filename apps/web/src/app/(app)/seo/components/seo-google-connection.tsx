"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useSession } from "@/lib/auth/auth.client";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoGoogleAccounts } from "./seo-google-accounts";
import {
  type SeoConnection,
  type SeoConnectionProvider,
  useSeoConnectionStatus,
} from "./use-seo-connection";

type GoogleConnectionProps = {
  /** The view's one primary action passes "primary"; it goes to the Search Console button. */
  variant?: "primary" | "outline";
  /** Runs after an approval, with the source that was approved. */
  onConnected?: (provider: SeoConnectionProvider) => void;
  /**
   * The control is the one action of a row: only the Search Console button,
   * unless a Google Analytics account waits for a repair. The second account
   * and the notes are in the views that have a column for them.
   */
  inRow?: boolean;
  /** Shared Search Console connection when the view shows failed actions itself. */
  searchModel?: SeoConnection;
  /** Opens the statistics settings from the account card's menu. */
  onSettings?: () => void;
};

function settledWithoutAccount(status: string | undefined) {
  return status === "not_connected" || status === "unavailable";
}

/**
 * One Google step for the two statistics sources. Each source has its own
 * Google approval, so Search Console comes first and Google Analytics follows.
 * The user leaves Google Analytics out in the approval window, not here.
 * The sync is not here: the view that shows the accounts has its own sync action.
 */
export function SeoGoogleConnection(props: GoogleConnectionProps) {
  const { data: session } = useSession();
  // A new viewer or workspace starts at its own step: the card of the last one does not stay.
  return (
    <GoogleConnectionStep
      key={JSON.stringify([
        session?.user.id,
        session?.session.activeOrganizationId,
      ])}
      {...props}
    />
  );
}

function GoogleConnectionStep({
  variant = "outline",
  onConnected,
  inRow,
  searchModel,
  onSettings,
}: GoogleConnectionProps) {
  const t = useTranslations("App.Seo");
  const search = useSeoConnectionStatus("search_console").status.data?.status;
  const ga4 = useSeoConnectionStatus("ga4").status.data?.status;
  const searchDone = search === "connected";
  // Once shown, the card stays. A switch of the only connected account reads "pending" during
  // its approval, and the card runs that approval: a remount would cancel it.
  // When both sources are settled without an account, the first-connection step returns.
  const [card, setCard] = useState(false);
  const cardNow = !inRow && (searchDone || ga4 === "connected");
  if (cardNow && !card) setCard(true);
  if (card && settledWithoutAccount(search) && settledWithoutAccount(ga4))
    setCard(false);
  // A Google Analytics account that is connected, or waits for a repair, has its own row.
  const analyticsStarted =
    ga4 !== undefined && ga4 !== "not_connected" && ga4 !== "unavailable";
  const searchButton = (
    <SeoConnectionButton
      provider="search_console"
      variant={variant}
      // Beside a Google Analytics account, the button names the source that is missing.
      connectLabel={
        analyticsStarted ? undefined : t("connections.connectGoogle")
      }
      onConnected={() => onConnected?.("search_console")}
      model={searchModel}
    />
  );
  const analyticsButton = (
    <SeoConnectionButton
      provider="ga4"
      onConnected={() => onConnected?.("ga4")}
    />
  );
  if (inRow && ga4 !== "needs_reconnect") return searchButton;
  // Once one source is connected, both sources are one card: one account, one check per source,
  // one menu. Only "connected" switches: a pending first approval keeps the control that runs it.
  if (!inRow && (cardNow || card))
    return <SeoGoogleAccounts onSettings={onSettings} />;
  // No status yet, a failed read, or no connections here: the button says all there is to say.
  const note =
    search && search !== "unavailable" && !analyticsStarted
      ? "connections.analyticsNext"
      : null;
  // One tree shape in every state: a status that changes during an approval
  // must not remount the control that runs it. One control under the other,
  // so every left edge is the same.
  return (
    <div className="flex max-w-full min-w-0 flex-col items-start gap-2">
      {searchButton}
      {/* The second approval is on offer once the first one is done. */}
      {/* A Google Analytics account that exists has its row before Search Console is done too. */}
      {analyticsStarted ? analyticsButton : null}
      {note ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t(note)}
        </p>
      ) : null}
    </div>
  );
}
