import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  ADMIN_SECTION_GROUPS,
  ADMIN_SECTIONS,
  type AdminSection,
  type AdminSectionGroup,
} from "./admin-sections";

export const metadata: Metadata = {
  title: "Admin",
  description: "Internal tools for accounts, billing, catalog, and operations.",
};

function sectionsByGroup(group: AdminSectionGroup): AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => section.group === group);
}

export default async function AdminOverviewPage() {
  const t = await getTranslations("App.Admin.Overview");

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
          const sections = sectionsByGroup(group);
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
                    <Card className="hover:border-primary/40 h-full gap-3 transition-colors hover:shadow-sm">
                      <CardHeader>
                        <Icon
                          className="text-muted-foreground size-5"
                          aria-hidden
                        />
                        <CardTitle>{t(`Sections.${key}.title`)}</CardTitle>
                        <CardDescription>
                          {t(`Sections.${key}.description`)}
                        </CardDescription>
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
