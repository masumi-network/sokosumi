"use client";

import { useEffect } from "react";

import { type ConnectResult, tellOpener } from "../../../lib/connect-window";

const COPY: Record<ConnectResult, string> = {
  connected: "Connected. You can close this window.",
  failed: "That connection didn't finish.",
  none: "That login has no ad account.",
};

/** Today's return address, for a window that could not close. */
const BACK: Record<ConnectResult, string> = {
  connected: "/?step=connect&from=onboarding",
  failed: "/?step=connect&from=onboarding&connect=failed",
  none: "/?step=connect&from=onboarding&ads=none",
};

/**
 * The end of Launch's connect window: tell Launch, then close. A window cut
 * from its opener may stay open, so it says where to go back.
 */
export function ConnectDone({ result }: { result: ConnectResult }) {
  useEffect(() => {
    tellOpener(result);
    window.close();
  }, [result]);

  return (
    <main className="hero">
      <div className="hero-copy">
        <h1>{COPY[result]}</h1>
        <a className="button" href={BACK[result]}>
          Back to CMO
        </a>
      </div>
    </main>
  );
}
