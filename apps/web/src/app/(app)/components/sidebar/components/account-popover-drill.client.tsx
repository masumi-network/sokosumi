"use client";

import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Cookie,
  LifeBuoy,
  Scale,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactElement, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";

import {
  getAccountNavItems,
  HELP_LINKS,
  type HelpLinkItem,
  LEGAL_LINKS,
  type LegalLinkItem,
} from "./account-menu-config";
import type { AccountPopoverPanel } from "./account-summary-types";
import { getDeveloperNavItems } from "./developer-menu-config";

interface AccountPopoverDrillProps {
  panel: Exclude<AccountPopoverPanel, { kind: "root" }>;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
  showDeveloperVendors: boolean;
  onNavigatePanel: (panel: AccountPopoverPanel) => void;
  onNavigateRoute: (href: string) => void;
  onOpenExternal: (url: string) => void;
  onOpenConsent: () => void;
}

function DrillRow({
  label,
  icon,
  onClick,
  chevron,
}: {
  label: string;
  icon: ReactElement;
  onClick: () => void;
  chevron?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground h-11 w-full justify-start gap-2 font-normal md:h-8"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {chevron ? (
        <ChevronRight className="size-4 shrink-0" aria-hidden />
      ) : null}
    </Button>
  );
}

export function AccountPopoverDrill({
  panel,
  members,
  activeOrganizationId,
  showDeveloperVendors,
  onNavigatePanel,
  onNavigateRoute,
  onOpenExternal,
  onOpenConsent,
}: AccountPopoverDrillProps): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const tMenu = useTranslations("App.Sidebar.Content.MenuItems");
  const tUserAvatar = useTranslations("Components.UserAvatar");
  const tConsent = useTranslations("CookieConsent");
  const tDeveloper = useTranslations("App.Developer.tabs");

  // Settings → drill unmounts the focused trigger; keep keyboard focus inside
  // the non-modal popover (rAF + tabIndex=-1).
  useMountEffect(() => {
    const frame = requestAnimationFrame(() => {
      panelRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  });

  function getAccountItemLabel(translationKey: string): string {
    return tUserAvatar(
      translationKey as
        | "account"
        | "billing"
        | "connections"
        | "notifications"
        | "organization",
    );
  }

  const title =
    panel.kind === "settings"
      ? tMenu("settings")
      : panel.kind === "developer"
        ? tUserAvatar("developer")
        : panel.kind === "help"
          ? tUserAvatar("help")
          : tUserAvatar("legal");

  const backPanel: AccountPopoverPanel =
    panel.kind === "settings" ? { kind: "root" } : { kind: "settings" };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="space-y-2 text-left outline-hidden"
    >
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onNavigatePanel(backPanel)}
          className="text-muted-foreground hover:text-foreground size-8 shrink-0 p-0"
          aria-label={tMenu("back")}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
      </div>
      <div className="bg-border h-px" />
      <div className="space-y-1">
        {panel.kind === "settings" ? (
          <>
            {getAccountNavItems({
              activeOrganizationId,
              members,
            }).map(({ key, href, translationKey, Icon }) => (
              <DrillRow
                key={key}
                label={getAccountItemLabel(translationKey)}
                icon={<Icon className="size-4 shrink-0" aria-hidden />}
                onClick={() => onNavigateRoute(href)}
              />
            ))}
            <DrillRow
              label={tUserAvatar("developer")}
              icon={<Code2 className="size-4 shrink-0" aria-hidden />}
              onClick={() => onNavigatePanel({ kind: "developer" })}
              chevron
            />
            <DrillRow
              label={tUserAvatar("help")}
              icon={<LifeBuoy className="size-4 shrink-0" aria-hidden />}
              onClick={() => onNavigatePanel({ kind: "help" })}
              chevron
            />
            <DrillRow
              label={tUserAvatar("legal")}
              icon={<Scale className="size-4 shrink-0" aria-hidden />}
              onClick={() => onNavigatePanel({ kind: "legal" })}
              chevron
            />
          </>
        ) : null}
        {panel.kind === "developer"
          ? getDeveloperNavItems({ showVendors: showDeveloperVendors }).map(
              ({ key, href, translationKey, Icon }) => (
                <DrillRow
                  key={key}
                  label={tDeveloper(translationKey)}
                  icon={<Icon className="size-4 shrink-0" aria-hidden />}
                  onClick={() => onNavigateRoute(href)}
                />
              ),
            )
          : null}
        {panel.kind === "help"
          ? HELP_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <DrillRow
                  key={item.translationKey}
                  label={tUserAvatar(
                    item.translationKey as HelpLinkItem["translationKey"],
                  )}
                  icon={
                    Icon ? (
                      <Icon className="size-4 shrink-0" aria-hidden />
                    ) : (
                      <span className="size-4 shrink-0" aria-hidden />
                    )
                  }
                  onClick={() => onOpenExternal(item.url)}
                />
              );
            })
          : null}
        {panel.kind === "legal" ? (
          <>
            {LEGAL_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <DrillRow
                  key={item.translationKey}
                  label={tUserAvatar(
                    item.translationKey as LegalLinkItem["translationKey"],
                  )}
                  icon={
                    Icon ? (
                      <Icon className="size-4 shrink-0" aria-hidden />
                    ) : (
                      <span className="size-4 shrink-0" aria-hidden />
                    )
                  }
                  onClick={() => onOpenExternal(item.url)}
                />
              );
            })}
            <DrillRow
              label={tConsent("settings")}
              icon={<Cookie className="size-4 shrink-0" aria-hidden />}
              onClick={onOpenConsent}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
