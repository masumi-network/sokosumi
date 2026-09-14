"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { AUTH_CAPTCHA_ACTION, AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { track } from "@vercel/analytics";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import {
  type ReactNode,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { getEnvPublicConfig } from "@/config/env.public";
import useIsClient from "@/hooks/use-is-client";
import { cn } from "@/lib/utils";

export interface CaptchaFetchOptions {
  headers?: { [AUTH_CAPTCHA_HEADER]: string };
}

export type AuthCaptchaEntry =
  | "signin"
  | "signup"
  | "forgot-password"
  | "magic-link"
  | "verify-email"
  | "change-email";

export interface AuthCaptcha {
  /**
   * The security check. Render it directly above the submit control. It has
   * no height unless Cloudflare asks the visitor to interact, and it carries
   * the load-failure message.
   */
  widget: ReactNode;
  runWithCaptcha: <T>(
    action: (options: CaptchaFetchOptions) => Promise<T>,
  ) => Promise<T | null>;
  getErrorMessage: (error: { code?: string }, fallback: string) => string;
}

const ANALYTICS_EVENT = "Security Check";
// Long enough for a slow interactive solve, short enough that a blocked
// script does not read as a hang.
const TOKEN_WAIT_MS = 8_000;

export function useAuthCaptcha(entry: AuthCaptchaEntry): AuthCaptcha {
  const siteKey = getEnvPublicConfig().NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const t = useTranslations("Components.AuthCaptcha");
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  // next-themes knows the theme on the client before hydration but not on
  // the server; render the widget only once hydrated so both agree.
  const isClient = useIsClient();
  const widgetRef = useRef<TurnstileInstance | null>(null);
  const failed = useRef(false);
  const interactive = useRef(false);
  const [loadError, setLoadError] = useState(false);
  // Two checks can share a page (password form plus magic-link row).
  const id = useId();
  // Turnstile keeps the widget on screen once it has asked for interaction
  // (including its solved state) until the next reset. Track that so the
  // hidden widget takes no room in the caller's layout.
  const [shown, setShown] = useState(false);

  const report = useCallback(
    (step: "interactive" | "solved" | "failed" | "load_error") => {
      track(ANALYTICS_EVENT, { entry, step });
    },
    [entry],
  );

  const handleFailure = useCallback(() => {
    failed.current = true;
    setShown(true);
    report("failed");
  }, [report]);

  const runWithCaptcha = useCallback(
    async <T,>(action: (options: CaptchaFetchOptions) => Promise<T>) => {
      // Omitting the public site key skips the check during local development.
      if (!siteKey) return action({});
      setLoadError(false);
      const token = failed.current
        ? null
        : await widgetRef.current
            ?.getResponsePromise(TOKEN_WAIT_MS)
            .catch(() => null);
      if (!token) {
        setLoadError(true);
        report("load_error");
        return null;
      }
      try {
        return await action({ headers: { [AUTH_CAPTCHA_HEADER]: token } });
      } finally {
        // Tokens are single-use; start verifying the next one right away.
        widgetRef.current?.reset();
        setShown(false);
      }
    },
    [siteKey, report],
  );

  const getErrorMessage = useCallback(
    (error: { code?: string }, fallback: string) => {
      switch (error.code) {
        case "VERIFICATION_FAILED":
          return t("verificationFailed");
        case "MISSING_RESPONSE":
          return t("missingResponse");
        case "UNKNOWN_ERROR":
          return t("requestFailed");
        default:
          return fallback;
      }
    },
    [t],
  );

  const widget =
    siteKey && isClient ? (
      <>
        <div className={cn(!shown && "absolute size-0 overflow-hidden")}>
          <Turnstile
            ref={widgetRef}
            id={id}
            siteKey={siteKey}
            options={{
              action: AUTH_CAPTCHA_ACTION,
              appearance: "interaction-only",
              size: "flexible",
              language: locale,
              theme:
                resolvedTheme === "dark" || resolvedTheme === "light"
                  ? resolvedTheme
                  : "auto",
            }}
            onBeforeInteractive={() => {
              interactive.current = true;
              setShown(true);
              report("interactive");
            }}
            onSuccess={() => {
              failed.current = false;
              if (!interactive.current) return;
              interactive.current = false;
              report("solved");
            }}
            onError={handleFailure}
            onUnsupported={handleFailure}
            scriptOptions={{ onError: handleFailure }}
          />
        </div>
        {loadError && (
          <p role="alert" className="text-destructive text-sm">
            {t("error")}
          </p>
        )}
      </>
    ) : null;

  return useMemo(
    () => ({ widget, runWithCaptcha, getErrorMessage }),
    [widget, runWithCaptcha, getErrorMessage],
  );
}
