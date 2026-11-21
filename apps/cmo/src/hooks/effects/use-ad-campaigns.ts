"use client";

import type { CmoAdCampaigns } from "@sokosumi/core-client";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

type AdAccounts = CmoAdCampaigns["accounts"];

/**
 * Loads the connected ad accounts' last-7-days campaigns whenever `connected`
 * or `loadAdCampaigns` changes, ignoring stale resolutions after cleanup.
 */
export function useAdCampaigns(
  connected: boolean,
  loadAdCampaigns: (range: "LAST_7_DAYS") => Promise<AdAccounts>,
): [AdAccounts | null, Dispatch<SetStateAction<AdAccounts | null>>] {
  const [accounts, setAccounts] = useState<AdAccounts | null>(null);

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

  return [accounts, setAccounts];
}
