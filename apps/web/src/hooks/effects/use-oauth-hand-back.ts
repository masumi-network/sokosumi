"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { claimSignUpConversion } from "@/lib/actions/auth/action";
import { authClient } from "@/lib/auth/auth.client";
import { fireGTMEvent } from "@/lib/gtm-events";

interface UseOAuthHandBackOptions {
  /** Automatically initiate the hand-back once on mount. */
  autoStart?: boolean;
}

/**
 * Hands a signed OAuth request back to Core's OAuth provider at most once,
 * claiming any new social sign-up conversion first. When `autoStart` is true,
 * initiates the hand-back automatically on mount.
 */
export function useOAuthHandBack(
  oauthQuery: string,
  options?: UseOAuthHandBackOptions,
) {
  const autoStart = options?.autoStart ?? false;
  const [hasFailed, setHasFailed] = useState(false);
  const hasStarted = useRef(false);

  function handBack(checkAccount?: () => Promise<boolean>) {
    // StrictMode mounts twice in development, and a person can press twice.
    // A second hand-back would issue a second authorization code.
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    // A social sign-up made during an OAuth request never reaches
    // /auth/callback/signup: Core sends it here instead. Count it before the
    // provider's answer navigates away (apps/web/TRACKING.md).
    claimSignUpConversion()
      .then((provider) => {
        if (provider) {
          fireGTMEvent.signUp(provider);
        }
      })
      .catch(() => undefined)
      .then(async () => {
        // Another tab can replace a confirmed account while the claim waits.
        if (checkAccount && !(await checkAccount())) {
          hasStarted.current = false;
          return;
        }
        const result = await authClient.oauth2.continue({
          created: true,
          oauth_query: oauthQuery,
        });
        if (result.error || !(result.data?.redirect && result.data.url)) {
          setHasFailed(true);
        }
      })
      .catch(() => {
        setHasFailed(true);
      });
  }

  const startOnMount = useEffectEvent(() => {
    if (autoStart) {
      handBack();
    }
  });

  useEffect(() => {
    startOnMount();
  }, []);

  return { hasFailed, handBack, fail: () => setHasFailed(true) };
}
