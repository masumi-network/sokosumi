import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { adminAdEvalsService } from "@/lib/services/admin-ad-evals.service";
import {
  ADMIN_SECTION_GROUPS,
  type AdminSection,
  type AdminSectionGroup,
  getVisibleAdminSections,
} from "./admin-sections";
import { SeoAlertSummary } from "./seo-alerts/seo-alert-summary";

export const metadata: Metadata = {
  title: "Admin",
  description: "Internal tools for accounts, billing, catalog, and operations.",
};

function sectionsByGroup(
  sections: AdminSection[],
  group: AdminSectionGroup,
): AdminSection[] {
  return sections.filter((section) => section.group === group);
}

export default async function AdminOverviewPage() {
  const [t, hasAdEvalsAccess] = await Promise.all([
    getTranslations("App.Admin.Overview"),
    adminAdEvalsService.hasAccess(),
  ]);
  const visibleSections = getVisibleAdminSections(hasAdEvalsAccess);

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-10 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        {ADMIN_SECTION_GROUPS.map((group) => {
          const sections = sectionsByGroup(visibleSections, group);
          if (sections.length === 0) {
            return null;
          }

          return (
            <section
              key={group}
              className="space-y-4"
              aria-labelledby={`admin-group-${group}`}
            >
              <h2
                id={`admin-group-${group}`}
                className="text-muted-foreground text-sm font-medium tracking-wide uppercase"
              >
                {t(`Groups.${group}`)}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {sections.map(({ key, href, Icon }) => (
                  <Link
                    key={key}
                    href={href}
                    className="focus-visible:ring-ring rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    <Card className="hover:border-border h-full gap-3 transition-colors hover:shadow-sm">
                      <CardHeader>
                        <Icon
                          className="text-muted-foreground size-5"
                          aria-hidden
                        />
                        <CardTitle>{t(`Sections.${key}.title`)}</CardTitle>
                        <CardDescription>
                          {t(`Sections.${key}.description`)}
                        </CardDescription>
                        {key === "seoAlerts" && (
                          <Suspense fallback={null}>
                            <SeoAlertSummary />
                          </Suspense>
                        )}
                      </CardHeader>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
