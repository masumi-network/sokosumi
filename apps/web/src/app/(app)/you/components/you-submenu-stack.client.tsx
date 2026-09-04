"use client";

import { Cookie } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactElement } from "react";
import {
  MobileStackedMenuAction,
  MobileStackedMenuGroup,
  MobileStackedMenuLink,
} from "@/app/components/mobile-stacked-menu/mobile-stacked-menu";
import { MobileStackedMenuScreen } from "@/app/components/mobile-stacked-menu/mobile-stacked-menu-screen";
import {
  HELP_LINKS,
  type HelpLinkItem,
  LEGAL_LINKS,
  type LegalLinkItem,
} from "@/app/components/sidebar/components/account-menu-config";
import { getDeveloperNavItems } from "@/app/components/sidebar/components/developer-menu-config";
import { openConsentPreferences } from "@/components/analytics/cookie-banner";

function openExternalUrl(url: string): void {
  if (url.startsWith("mailto:")) {
    window.location.href = url;
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function YouDeveloperStackClient({
  showDeveloperVendors = false,
}: {
  showDeveloperVendors?: boolean;
}): ReactElement {
  const tCredit = useTranslations("Components.UserAvatar");
  const tDeveloper = useTranslations("App.Developer.tabs");

  return (
    <MobileStackedMenuScreen title={tCredit("developer")}>
      <MobileStackedMenuGroup>
        {getDeveloperNavItems({ showVendors: showDeveloperVendors }).map(
          ({ key, href, translationKey, Icon }) => (
            <MobileStackedMenuLink
              key={key}
              href={href}
              icon={<Icon className="size-4 shrink-0" aria-hidden />}
              label={tDeveloper(translationKey)}
              testId={`you-developer-${key}`}
            />
          ),
        )}
      </MobileStackedMenuGroup>
    </MobileStackedMenuScreen>
  );
}

export function YouHelpStackClient(): ReactElement {
  const tCredit = useTranslations("Components.UserAvatar");

  return (
    <MobileStackedMenuScreen title={tCredit("help")}>
      <MobileStackedMenuGroup>
        {HELP_LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <MobileStackedMenuAction
              key={item.translationKey}
              icon={
                Icon ? (
                  <Icon className="size-4 shrink-0" aria-hidden />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )
              }
              label={tCredit(
                item.translationKey as HelpLinkItem["translationKey"],
              )}
              testId={`you-help-${item.translationKey}`}
              onClick={() => openExternalUrl(item.url)}
              chevron={false}
            />
          );
        })}
      </MobileStackedMenuGroup>
    </MobileStackedMenuScreen>
  );
}

export function YouLegalStackClient(): ReactElement {
  const tCredit = useTranslations("Components.UserAvatar");
  const tConsent = useTranslations("CookieConsent");

  return (
    <MobileStackedMenuScreen title={tCredit("legal")}>
      <MobileStackedMenuGroup>
        {LEGAL_LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <MobileStackedMenuAction
              key={item.translationKey}
              icon={
                Icon ? (
                  <Icon className="size-4 shrink-0" aria-hidden />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )
              }
              label={tCredit(
                item.translationKey as LegalLinkItem["translationKey"],
              )}
              testId={`you-legal-${item.translationKey}`}
              onClick={() => openExternalUrl(item.url)}
              chevron={false}
            />
          );
        })}
        <MobileStackedMenuAction
          icon={<Cookie className="size-4 shrink-0" aria-hidden />}
          label={tConsent("settings")}
          testId="you-cookie-consent"
          onClick={openConsentPreferences}
          chevron={false}
        />
      </MobileStackedMenuGroup>
    </MobileStackedMenuScreen>
  );
}
