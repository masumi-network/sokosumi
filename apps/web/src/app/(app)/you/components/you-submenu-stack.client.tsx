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
import type { YouSubmenuKind } from "@/app/you/you-submenu-paths";
import { openConsentPreferences } from "@/components/analytics/cookie-banner";

export interface YouSubmenuStackClientProps {
  kind: YouSubmenuKind;
  showDeveloperVendors?: boolean;
}

function openExternalUrl(url: string): void {
  if (url.startsWith("mailto:")) {
    window.location.href = url;
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function YouSubmenuStackClient({
  kind,
  showDeveloperVendors = false,
}: YouSubmenuStackClientProps): ReactElement {
  const tCredit = useTranslations("Components.UserAvatar");
  const tDeveloper = useTranslations("App.Developer.tabs");
  const tConsent = useTranslations("CookieConsent");

  const title =
    kind === "developer"
      ? tCredit("developer")
      : kind === "help"
        ? tCredit("help")
        : tCredit("legal");

  return (
    <MobileStackedMenuScreen title={title}>
      <MobileStackedMenuGroup>
        {kind === "developer"
          ? getDeveloperNavItems({ showVendors: showDeveloperVendors }).map(
              ({ key, href, translationKey, Icon }) => (
                <MobileStackedMenuLink
                  key={key}
                  href={href}
                  icon={<Icon className="size-4 shrink-0" aria-hidden />}
                  label={tDeveloper(translationKey)}
                  testId={`you-developer-${key}`}
                />
              ),
            )
          : null}
        {kind === "help"
          ? HELP_LINKS.map((item) => {
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
            })
          : null}
        {kind === "legal" ? (
          <>
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
          </>
        ) : null}
      </MobileStackedMenuGroup>
    </MobileStackedMenuScreen>
  );
}
