"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, Suspense, useState } from "react";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { useNavPathname } from "@/components/navigation-progress.client";
import { RestingIntentLink } from "@/components/resting-intent-link";
import { Collapsible } from "@/components/ui/collapsible";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRowSlot,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_ROW_CLASS,
  SIDEBAR_ROW_LABEL_CLASS,
  SIDEBAR_ROW_LINK_CLASS,
} from "@/components/ui/sidebar-classes";
import {
  SidebarSectionContent,
  SidebarSectionTrigger,
} from "@/components/ui/sidebar-section";
import { cn } from "@/lib/utils";
import { isPathActive } from "@/lib/utils/is-path-active";
import { useMarkFeatureSeen } from "./feature-badges";
import { useSidebarPanel } from "./sidebar-context-panel";
import {
  SIDEBAR_FEATURE_LABEL_CLASS,
  SidebarFeatureLabel,
} from "./sidebar-feature-label";
import { NAV_DESTINATIONS, type SidebarDestination } from "./sidebar-sections";

/**
 * `newsletterEnabled` is off by default so the Instant Nav shell, which has
 * not resolved workspace availability yet, leaves the row out rather than
 * guessing it: a row that appears once is cheaper than one that appears and
 * then goes away.
 */
export default function MenuItems({
  newsletterEnabled = false,
}: {
  newsletterEnabled?: boolean;
} = {}) {
  return (
    <Suspense fallback={null}>
      <ScopedMenuItems newsletterEnabled={newsletterEnabled} />
    </Suspense>
  );
}

const destinations: readonly SidebarDestination[] = NAV_DESTINATIONS;

function ScopedMenuItems({
  newsletterEnabled,
}: {
  newsletterEnabled: boolean;
}) {
  const { hrefFor } = useProjectScope();
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const navPathname = useNavPathname();
  const { isMobile } = useSidebar();
  const markFeatureSeen = useMarkFeatureSeen();

  const { section: group } = useSidebarPanel();

  function renderItem({
    key,
    href,
    labelKey,
    Icon,
    feature,
    prefetchContent,
  }: SidebarDestination) {
    const label = t(labelKey);
    const isActive = isPathActive(navPathname, href);

    return (
      <SidebarMenuItem key={key}>
        <SidebarMenuButton asChild isActive={isActive}>
          <SheetClose asChild>
            <RestingIntentLink
              href={hrefFor(href)}
              // The list on screen needs no prefetch of its own content. A
              // task detail page still marks Tasks active, so match exactly.
              prefetchContent={prefetchContent === true && pathname !== href}
              onClick={() => feature && markFeatureSeen(feature)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                isActive
                  ? "text-sidebar-accent-foreground"
                  : SIDEBAR_ROW_LINK_CLASS,
              )}
            >
              <SidebarRowSlot aria-hidden>
                <Icon aria-hidden />
              </SidebarRowSlot>
              <span
                className={cn(
                  SIDEBAR_ROW_LABEL_CLASS,
                  SIDEBAR_FEATURE_LABEL_CLASS,
                )}
              >
                {feature ? (
                  <SidebarFeatureLabel label={label} feature={feature} />
                ) : (
                  <span className="min-w-0 truncate">{label}</span>
                )}
              </span>
            </RestingIntentLink>
          </SheetClose>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    // `px-2` here rather than on the item, so a nav row's `SidebarMenuItem`
    // is the same box a Chat row's is.
    <SidebarGroup className="w-full px-2 py-0">
      {/* 4px over Work, so the first heading sits just under the project
          title it hangs from. The 8px under the last group stacks on the
          Chats group's own 8px: that wider gap is what separates the
          project-scoped nav from the workspace-wide chats from md, where the
          scope's hairline is gone. */}
      <SidebarGroupContent className="pt-1 pb-2">
        {group !== "chats" ? (
          <MenuGroup key={group} title={t(`groups.${group}`)}>
            {destinations
              .filter(
                (destination) =>
                  destination.group === group &&
                  !(isMobile && destination.desktopOnly) &&
                  (newsletterEnabled || !destination.requiresNewsletter),
              )
              .map(renderItem)}
          </MenuGroup>
        ) : null}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * A nav group under its heading, which folds it. Open on every load: the
 * state is in memory only, so a group folded away comes back on reload.
 */
function MenuGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={SIDEBAR_ROW_CLASS}>
        <SidebarSectionTrigger title={title} />
      </div>
      <SidebarSectionContent>
        <SidebarMenu className="gap-0">{children}</SidebarMenu>
      </SidebarSectionContent>
    </Collapsible>
  );
}
