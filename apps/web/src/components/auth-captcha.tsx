"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { AUTH_CAPTCHA_ACTION, AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { track } from "@vercel/analytics";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { type ReactNode, useCallback, useId, useRef, useState } from "react";

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

async function waitForCaptchaToken(
  getWidget: () => TurnstileInstance | null,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const widget = getWidget();
    if (widget) {
      const remaining = Math.max(1, deadline - Date.now());
      return widget.getResponsePromise(remaining).catch(() => null);
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function useAuthCaptcha(entry: AuthCaptchaEntry): AuthCaptcha {
  const siteKey = getEnvPublicConfig().NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const t = useTranslations("Components.AuthCaptcha");
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  // next-themes hydrates after the first client paint. Mounting with theme
  // "auto" and then switching to light/dark remounts Turnstile and drops the
  // pre-fetched token. Skip the server paint so hydration matches.
  const isClient = useIsClient();
  const widgetTheme =
    resolvedTheme === "dark" || resolvedTheme === "light"
      ? resolvedTheme
      : undefined;
  const widgetRef = useRef<TurnstileInstance | null>(null);
  const loadFailed = useRef(false);
  const widgetFailed = useRef(false);
  const interactive = useRef(false);
  const shownRef = useRef(false);
  const [alert, setAlert] = useState<"load" | "missing" | null>(null);
  // Two checks can share a page (password form plus magic-link row).
  const id = useId();
  // Turnstile keeps the widget on screen once it has asked for interaction
  // (including its solved state) until the next reset. Track that so the
  // hidden widget takes no room in the caller's layout.
  const [shown, setShown] = useState(false);

  const revealWidget = useCallback(() => {
    shownRef.current = true;
    setShown(true);
  }, []);

  const hideWidget = useCallback(() => {
    shownRef.current = false;
    setShown(false);
  }, []);

  const report = useCallback(
    (step: "interactive" | "solved" | "failed" | "load_error") => {
      track(ANALYTICS_EVENT, { entry, step });
    },
    [entry],
  );

  const handleScriptError = useCallback(() => {
    loadFailed.current = true;
    setAlert("load");
    report("load_error");
  }, [report]);

  // Turnstile retries a failed widget on its own (`retry: "auto"`). Resetting
  // here would restart it immediately and loop on a persistent error, so only
  // report the first failure of a streak.
  const handleWidgetError = useCallback(() => {
    if (widgetFailed.current) return;
    widgetFailed.current = true;
    report("failed");
  }, [report]);

  const runWithCaptcha = useCallback(
    async <T,>(action: (options: CaptchaFetchOptions) => Promise<T>) => {
      // Omitting the public site key skips the check in any environment.
      if (!siteKey) return action({});
      if (loadFailed.current) {
        setAlert("load");
        return null;
      }
      setAlert(null);
      const token = await waitForCaptchaToken(
        () => widgetRef.current,
        TOKEN_WAIT_MS,
      );
      if (loadFailed.current) {
        setAlert("load");
        return null;
      }
      if (!token) {
        if (shownRef.current || interactive.current) {
          setAlert("missing");
        } else {
          setAlert("load");
          report("load_error");
        }
        return null;
      }
      try {
        return await action({ headers: { [AUTH_CAPTCHA_HEADER]: token } });
      } finally {
        // Tokens are single-use; start verifying the next one right away.
        widgetRef.current?.reset();
        hideWidget();
      }
    },
    [siteKey, report, hideWidget],
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
    siteKey && isClient && widgetTheme ? (
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
              theme: widgetTheme,
            }}
            onBeforeInteractive={() => {
              interactive.current = true;
              revealWidget();
              report("interactive");
            }}
            onSuccess={() => {
              loadFailed.current = false;
              widgetFailed.current = false;
              setAlert(null);
              if (!interactive.current) return;
              interactive.current = false;
              report("solved");
            }}
            onExpire={() => {
              widgetRef.current?.reset();
              hideWidget();
            }}
            onError={handleWidgetError}
            onUnsupported={handleWidgetError}
            scriptOptions={{ onError: handleScriptError }}
          />
        </div>
        {alert ? (
          <p role="alert" className="text-destructive text-sm">
            {t(alert === "load" ? "error" : "missingResponse")}
          </p>
        ) : null}
      </>
    ) : null;

  return { widget, runWithCaptcha, getErrorMessage };
}
