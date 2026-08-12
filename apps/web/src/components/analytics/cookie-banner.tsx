"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MOBILE_BREAKPOINT } from "@/hooks/use-mobile";
import {
  applyConsentMode,
  type ConsentChoice,
  readConsent,
  writeConsent,
} from "@/lib/analytics/consent";
import { cn } from "@/lib/utils";

const COOKIE_POLICY_URL = "https://www.sokosumi.com/legal/cookie-policy";

/** Reopen the preferences panel from anywhere (e.g. a footer link). */
export const OPEN_CONSENT_EVENT = "sokosumi:open-consent";

export function openConsentPreferences() {
  window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
}

/** Desktop app chrome reserves a left sidebar; align to that column, not the viewport. */
export function mainChromeLeftPx(
  viewportWidth: number,
  sidebarGapWidth: number | null,
): number {
  if (viewportWidth < MOBILE_BREAKPOINT) return 0;
  return sidebarGapWidth ?? 0;
}

function useMainChromeLeftPx(): number {
  const [leftPx, setLeftPx] = useState(0);

  useEffect(() => {
    let observer: ResizeObserver | undefined;

    function measure() {
      const gap = document.querySelector<HTMLElement>(
        "[data-slot=sidebar-gap]",
      );
      setLeftPx(
        mainChromeLeftPx(
          window.innerWidth,
          gap?.getBoundingClientRect().width ?? null,
        ),
      );
    }

    measure();
    const gap = document.querySelector("[data-slot=sidebar-gap]");
    if (gap) {
      observer = new ResizeObserver(measure);
      observer.observe(gap);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return leftPx;
}

/**
 * Self-built cookie banner (no third-party CMP). Records the visitor's choice
 * in the shared `.sokosumi.com` cookie and flips Google Consent Mode v2
 * accordingly. The denied-by-default state is set earlier by <ConsentModeInit>,
 * before GTM loads. See apps/web/TRACKING.md.
 */
export function CookieBanner() {
  const t = useTranslations("CookieConsent");
  const chromeLeftPx = useMainChromeLeftPx();
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const stored = readConsent();
    if (!stored) setVisible(true);

    const reopen = () => {
      const current = readConsent();
      setAnalytics(current?.analytics ?? false);
      setMarketing(current?.marketing ?? false);
      setExpanded(true);
      setVisible(true);
    };
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  if (!visible) return null;

  const decide = (choice: Omit<ConsentChoice, "necessary">) => {
    const stored = writeConsent(choice);
    applyConsentMode(stored);
    setVisible(false);
    setExpanded(false);
  };

  return (
    <div
      role="dialog"
      aria-label={t("title")}
      className="fixed right-0 bottom-0 z-[100] p-3 transition-[left] duration-200 sm:p-5"
      style={{ left: chromeLeftPx }}
    >
      <div className="bg-background w-full rounded-lg border p-5 shadow-2xl">
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          {t("body")}{" "}
          <a
            href={COOKIE_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline"
          >
            {t("policyLink")}
          </a>
          .
        </p>

        {expanded && (
          <div className="mt-4 flex flex-col gap-3">
            <Category
              title={t("necessaryTitle")}
              body={t("necessaryBody")}
              checked
              disabled
            />
            <Category
              title={t("analyticsTitle")}
              body={t("analyticsBody")}
              checked={analytics}
              onChange={setAnalytics}
            />
            <Category
              title={t("marketingTitle")}
              body={t("marketingBody")}
              checked={marketing}
              onChange={setMarketing}
            />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => decide({ analytics: true, marketing: true })}
          >
            {t("acceptAll")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => decide({ analytics: false, marketing: false })}
          >
            {t("rejectAll")}
          </Button>
          {expanded ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => decide({ analytics, marketing })}
            >
              {t("save")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground ml-auto"
              onClick={() => setExpanded(true)}
            >
              {t("manage")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Category({
  title,
  body,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  body: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (value: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "grid grid-cols-[1rem_1fr] items-start gap-3",
        disabled ? "cursor-default" : "cursor-pointer",
      )}
    >
      <input
        type="checkbox"
        className="accent-primary mt-1 size-4"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
          {body}
        </span>
      </span>
    </label>
  );
}
