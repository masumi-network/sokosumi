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
 */
export function DeveloperSectionsHeader({
  showVendors,
}: {
  showVendors: boolean;
}) {
  const t = useTranslations("App.Developer");
  const pathname = usePathname();
  const items = getDeveloperNavItems({ showVendors });

  if (!items.some((item) => item.href === pathname)) {
    return null;
  }

  return (
    <div className="mx-auto hidden max-w-4xl space-y-4 px-4 pt-2 md:block">
      <h1 className="text-2xl font-light tracking-tight">{t("title")}</h1>
      <ProjectTabs
        ariaLabel={t("sectionsLabel")}
        tabs={items.map((item) => ({
          id: item.key,
          href: item.href,
          label: t(`tabs.${item.translationKey}`),
        }))}
      />
    </div>
  );
}
