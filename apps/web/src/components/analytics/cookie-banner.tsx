"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { NEWSLETTER_EMBED_PATH } from "@/config/document-security-headers";
import {
  mainChromeLeftPx,
  useCookieBannerChromeLeftPx,
} from "@/hooks/effects/use-cookie-banner-chrome-left";
import {
  openCookieConsentPreferences,
  useCookieConsentBanner,
} from "@/hooks/effects/use-cookie-consent-banner";
import { cn } from "@/lib/utils";

const COOKIE_POLICY_URL = "https://www.sokosumi.com/legal/cookie-policy";

/** Reopen the preferences panel from anywhere (e.g. a footer link). */
export function openConsentPreferences() {
  openCookieConsentPreferences();
}

export { mainChromeLeftPx };

/**
 * Self-built cookie banner (no third-party CMP). Records the visitor's choice
 * in the shared `.sokosumi.com` cookie and flips Google Consent Mode v2
 * accordingly. The denied-by-default state is set earlier by <ConsentModeInit>,
 * before GTM loads. See apps/web/TRACKING.md.
 */
export function CookieBanner() {
  const t = useTranslations("CookieConsent");
  const pathname = usePathname();
  const chromeLeftPx = useCookieBannerChromeLeftPx();
  const {
    visible,
    expanded,
    setExpanded,
    analytics,
    setAnalytics,
    marketing,
    setMarketing,
    product,
    decide,
  } = useCookieConsentBanner();

  if (!visible || NEWSLETTER_EMBED_PATH.test(pathname)) return null;

  return (
    <div
      role="dialog"
      aria-label={t("title")}
      className="fixed right-0 bottom-0 z-[100] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-[left] duration-200 sm:p-5"
      style={{ left: chromeLeftPx }}
    >
      <div className="app-scrollbar bg-background max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-lg border p-5 shadow-lg">
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          {t("body", { product })}{" "}
          <a
            href={
              product === "CMO.XYZ"
                ? "https://www.cmo.xyz/privacy#cookies-and-similar-storage"
                : COOKIE_POLICY_URL
            }
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
              body={t("marketingBody", { product })}
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
        className="accent-foreground mt-1 size-4"
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
