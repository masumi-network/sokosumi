import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { ADMIN_SECTIONS } from "./admin-sections";

export const metadata: Metadata = {
  title: "Admin",
  description: "Internal admin console",
};

export default async function AdminOverviewPage() {
  const t = await getTranslations("App.Admin.Overview");

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {ADMIN_SECTIONS.map(({ key, href, Icon }) => (
            <Link
              key={key}
              href={href}
              className="focus-visible:ring-ring rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              <Card className="hover:border-primary/40 h-full gap-3 transition-colors hover:shadow-sm">
                <CardHeader>
                  <Icon className="text-muted-foreground size-5" aria-hidden />
                  <CardTitle>{t(`Sections.${key}.title`)}</CardTitle>
                  <CardDescription>
                    {t(`Sections.${key}.description`)}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
