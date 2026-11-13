"use client";

import type { CmoOverview } from "@sokosumi/core-client";

import { AGENT_NAME } from "../../lib/agent";
import { type StartTopUp, TopUpButton } from "../top-up";
import { type OpenPortal, PortalButton } from "./subscription-card";

/** Why Cuso is paused, as the way out: a plan to buy or a payment to fix. */
export type CmoPause = "subscribe" | "fixPayment";

/**
 * Core's CMO subscription gate (`subscriptionActive`) says whether Cuso may
 * work; a subscription that has not ended but is not active (past due) needs
 * its payment fixed in Polar's portal, anything else a plan (ADR 0068).
 */
export function cmoPause(
  overview: Pick<CmoOverview, "subscriptionActive" | "billing">,
): CmoPause | null {
  if (overview.subscriptionActive) return null;
  const { status } = overview.billing;
  return status !== null && status !== "active" ? "fixPayment" : "subscribe";
}

/** The plan checkout when Cuso is paused for want of a plan, else null. */
export function subscribeOffer(
  overview: Pick<CmoOverview, "subscriptionActive" | "billing">,
  subscribe: StartTopUp,
): StartTopUp | null {
  return cmoPause(overview) === "subscribe" ? subscribe : null;
}

/** Cuso is paused without a paid CMO plan: why, and the way out. */
export function PausedBanner({
  pause,
  billing,
  subscribe,
  openPortal,
}: {
  pause: CmoPause;
  billing: CmoOverview["billing"];
  /** Starts the CMO plan checkout. */
  subscribe: StartTopUp;
  openPortal: OpenPortal;
}) {
  return (
    <div className="banner" role="status">
      <span className="sw" aria-hidden="true" />
      {pause === "subscribe" ? (
        <>
          <b>{AGENT_NAME} is paused: no CMO plan yet.</b>
          <span className="muted">He starts again once a plan is paid.</span>
          <span className="sp" />
          <TopUpButton startTopUp={subscribe} label="Subscribe" />
        </>
      ) : (
        <>
          <b>{AGENT_NAME} is paused: the last payment failed.</b>
          {billing.viewerCanManage ? (
            <>
              <span className="muted">
                He starts again once it goes through.
              </span>
              <span className="sp" />
              <PortalButton openPortal={openPortal} label="Fix payment" />
            </>
          ) : (
            <span className="muted">
              An owner or admin of the organization can fix it in Settings.
            </span>
          )}
        </>
      )}
    </div>
  );
}
