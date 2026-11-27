"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { getDeveloperNavItems } from "@/app/components/sidebar/components/developer-menu-config";
import { ProjectTabs } from "@/app/projects/components/project-tabs";

/**
 * One "Developer" heading and a row of its sections, so switching section is
 * one click instead of a trip through the account popover. Desktop only:
 * phones reach the sections from You → Developer and go back there.
 * Detail pages (a coworker, task or vendor) keep their own header.
 *
 * Only Vendors waits for the admin lookup; the vendor pages enforce access
 * themselves, so the row shows on them straight away.
 */
export function DeveloperSectionsHeader({
  showVendors,
}: {
  showVendors: Promise<boolean>;
}) {
  const t = useTranslations("App.Developer");
  const pathname = usePathname();
  const items = getDeveloperNavItems({ showVendors: true });

  if (!items.some((item) => item.href === pathname)) {
    return null;
  }

  // `w-full`: the page column is a flex column, and auto margins alone
  // would shrink the row to its links instead of lining it up with the page.
  return (
    <div className="hidden w-full space-y-4 pt-2 pb-4 md:block">
      <h1 className="text-2xl font-light tracking-tight">{t("title")}</h1>
      <ProjectTabs
        ariaLabel={t("sectionsLabel")}
        tabs={items.map((item) => ({
          id: item.key,
          href: item.href,
          label: t(`tabs.${item.translationKey}`),
          when: item.key === "vendors" ? showVendors : undefined,
        }))}
      />
    </div>
  );
}
