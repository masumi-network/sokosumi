"use client";

import type { CmoOverview, CmoSubscriptionPlan } from "@sokosumi/core-client";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type AnalyticsConsent,
  appEvents,
  flushAnalytics,
  GA_MEASUREMENT_ID,
  milestones,
  setUserProperties,
  track,
  userProperties,
  viewPlans,
  withEvents,
} from "../../lib/analytics";

const CONSENT_MAX_AGE_S = 180 * 24 * 60 * 60;
const USER_KEY = "cmo-analytics-user";

export interface AnalyticsUser {
  userId: string;
  event: "sign_up" | "login" | null;
}

type Gtag = (...args: unknown[]) => void;
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };

function loadGtag(userId: string | null) {
  const w = window as AnalyticsWindow;
  if (w.gtag) return;
  w.dataLayer = w.dataLayer ?? [];
  w.gtag = function gtag() {
    // gtag.js reads the arguments object itself, not an array.
    w.dataLayer?.push(arguments);
  };
  w.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  w.gtag("js", new Date());
  w.gtag("config", GA_MEASUREMENT_ID, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_expires: CONSENT_MAX_AGE_S,
    cookie_update: false,
    ...(userId ? { user_id: userId } : {}),
  });
  const script = document.createElement("script");
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  script.async = true;
  document.head.append(script);
  flushAnalytics();
}

function hasGpc(): boolean {
  return (
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true
  );
}

/** Removes the sign-in marker from the address; true when it was there. */
function takeSignInMarker(): boolean {
  const url = new URL(location.href);
  if (!url.searchParams.has("signed_in")) return false;
  url.searchParams.delete("signed_in");
  history.replaceState(history.state, "", url);
  return true;
}

/**
 * Loads the tag once analytics is granted and no Global Privacy Control
 * signal is on, with the Core user id when signed in; the first page after a
 * sign-in sends sign_up or login. Returns whether the GPC signal is on.
 */
export function useAnalyticsTag(
  choice: AnalyticsConsent,
  signedIn: boolean,
  readUser: (justSignedIn: boolean) => Promise<AnalyticsUser | null>,
): boolean {
  const [gpc, setGpc] = useState(false);
  // Kept until the event is sent: a yes on the banner comes after the marker is gone.
  const signInMarker = useRef<boolean | null>(null);
  useEffect(() => {
    signInMarker.current ??= takeSignInMarker();
    const justSignedIn = signInMarker.current;
    const signal = hasGpc();
    setGpc(signal);
    if (choice !== "granted" || signal) return;
    if (!signedIn) {
      sessionStorage.removeItem(USER_KEY);
      loadGtag(null);
      return;
    }
    const known = sessionStorage.getItem(USER_KEY);
    if (known && !justSignedIn) {
      loadGtag(known);
      return;
    }
    void readUser(justSignedIn)
      .catch(() => null)
      .then((user) => {
        if (user) sessionStorage.setItem(USER_KEY, user.userId);
        loadGtag(user?.userId ?? null);
        if (user?.event) track(user.event, { method: "cmo" });
        signInMarker.current = false;
      });
  }, [choice, signedIn, readUser]);
  return gpc;
}

/** The plans as a GA4 list each time the Subscribe step shows them. */
export function usePlansViewed(
  showing: boolean,
  plans: CmoSubscriptionPlan[],
  interval: CmoSubscriptionPlan["interval"],
) {
  useEffect(() => {
    if (showing && plans.length > 0) track(...viewPlans(plans, interval));
  }, [showing, plans, interval]);
}

/** The app's actions, each sending its GA4 event; they read the newest overview. */
export function useAppEvents<T extends object>(
  actions: T,
  overview: CmoOverview,
): T {
  const latest = useRef(overview);
  useEffect(() => {
    latest.current = overview;
  }, [overview]);
  return useMemo(
    () =>
      withEvents(
        actions,
        appEvents(() => latest.current),
      ),
    [actions],
  );
}

const seenKey = (projectId: string) => `cmo-analytics-seen:${projectId}`;

function readSeen(projectId: string): Set<string> | null {
  try {
    const saved = localStorage.getItem(seenKey(projectId));
    return saved ? new Set(JSON.parse(saved) as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * Sends each GA4 milestone of this Cuso once per browser, and his plan as
 * user properties. A Cuso hired before tracking started is remembered
 * silently the first time, so old milestones do not count as new.
 */
export function useAnalytics(overview: CmoOverview) {
  useEffect(() => {
    setUserProperties(userProperties(overview));
    const reached = milestones(overview);
    const seen = readSeen(overview.projectId);
    const quiet = seen === null && overview.onboardingStep === "done";
    const known = seen ?? new Set<string>();
    let changed = seen === null;
    for (const { key, event } of reached) {
      if (known.has(key)) continue;
      known.add(key);
      changed = true;
      if (!quiet) track(...event);
    }
    if (!changed) return;
    try {
      localStorage.setItem(
        seenKey(overview.projectId),
        JSON.stringify([...known]),
      );
    } catch {}
  }, [overview]);
}
