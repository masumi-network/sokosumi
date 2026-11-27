"use client";

import { useState } from "react";

import {
  type AnalyticsUser,
  useAnalyticsTag,
} from "../hooks/effects/use-analytics";
import { type AnalyticsConsent, CONSENT_COOKIE } from "../lib/analytics";

const CONSENT_MAX_AGE_S = 180 * 24 * 60 * 60;
const REJECT_MAX_AGE_S = 400 * 24 * 60 * 60;

function saveChoice(choice: "granted" | "denied") {
  const domain = /(^|\.)cmo\.xyz$/.test(location.hostname)
    ? "; domain=.cmo.xyz"
    : "";
  const maxAge = choice === "granted" ? CONSENT_MAX_AGE_S : REJECT_MAX_AGE_S;
  document.cookie = `${CONSENT_COOKIE}=${choice}; Max-Age=${maxAge}; path=/; SameSite=Lax; Secure${domain}`;
}

interface AnalyticsProps {
  consent: AnalyticsConsent;
  signedIn: boolean;
  readUser: (justSignedIn: boolean) => Promise<AnalyticsUser | null>;
}

/**
 * Google Analytics after consent, with the same choice as www.cmo.xyz: the
 * tag loads only once it is granted, and a Global Privacy Control signal
 * keeps it off. Signed in, every hit carries the Core user id, and the first
 * page after a sign-in sends sign_up or login.
 */
export function Analytics({ consent, signedIn, readUser }: AnalyticsProps) {
  const [choice, setChoice] = useState(consent);
  const gpc = useAnalyticsTag(choice, signedIn, readUser);

  if (choice !== "ask" || gpc) return null;
  const decide = (value: "granted" | "denied") => {
    saveChoice(value);
    setChoice(value);
  };
  return (
    <section className="cookie-panel" aria-label="Your privacy choices">
      <h2>Your privacy choices</h2>
      <p>
        Google Analytics helps us see which pages people visit. Allow it or turn
        it off. You can change this any time on www.cmo.xyz.{" "}
        <a href="https://www.cmo.xyz/privacy#cookies-and-similar-storage">
          How we use cookies
        </a>
      </p>
      <div className="cookie-actions">
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => decide("denied")}
        >
          Reject analytics
        </button>
        <button
          type="button"
          className="button button-small"
          onClick={() => decide("granted")}
        >
          Allow analytics
        </button>
      </div>
    </section>
  );
}
