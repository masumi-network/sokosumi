"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  activeProjectTabId,
  type ProjectTab,
} from "@/app/projects/components/project-tabs";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
} from "@/components/ui/tabs-classes";
import { cn } from "@/lib/utils";

/** Each tab is a new page, which resets the row's scroll: keep the active one in view. */
function revealActiveTab(tab: HTMLAnchorElement | null) {
  tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * The newsletter's sections, in the same segmented switch as Ads and Social.
 *
 * Links, not Radix tabs: each section is its own route. They wear the shared
 * segmented-tab classes, which key the active look on `data-state`. Six labels
 * do not fit a phone, so the row scrolls sideways like Ads'.
 */
export function NewsletterTabs({
  ariaLabel,
  tabs,
}: {
  ariaLabel: string;
  tabs: readonly ProjectTab[];
}) {
  const pathname = usePathname();
  const activeId = activeProjectTabId(pathname, tabs);

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        SEGMENTED_TABS_LIST_CLASS_NAME,
        "app-scrollbar h-9 w-fit min-w-0 max-w-full overflow-x-auto",
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <Link
            key={tab.id}
            ref={isActive ? revealActiveTab : undefined}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            data-state={isActive ? "active" : "inactive"}
            className={cn(
              SEGMENTED_TAB_TRIGGER_CLASS_NAME,
              // What `TabsTrigger` would otherwise give a link: the height and the row.
              "press inline-flex h-[calc(100%-1px)] shrink-0 items-center justify-center whitespace-nowrap",
              "focus-visible:ring-ring outline-none focus-visible:ring-2",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
