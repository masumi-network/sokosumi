"use client";

import { useEffect, useState } from "react";

import { adsReturnError } from "../../components/ads";
import { connectReturnError } from "../../lib/connect-return";

/**
 * Reads a connection or ads return notice before stripping non-checkout query
 * parameters from the onboarding URL.
 */
export function useOnboardingReturnNotice(
  returnedFromCheckout: boolean,
): string | null {
  // Why a connection came back without an account, read before the query goes.
  const [returnNotice, setReturnNotice] = useState<string | null>(null);

  // The connection redirect's query has been read; a reload routes from Core.
  useEffect(() => {
    setReturnNotice(
      connectReturnError(
        new URLSearchParams(window.location.search).get("connect"),
      ) ?? adsReturnError(),
    );
    // Polar's return address stays, so a reload keeps confirming the payment.
    if (window.location.search && !returnedFromCheckout) {
      window.history.replaceState(null, "", "/");
    }
  }, [returnedFromCheckout]);

  return returnNotice;
}
