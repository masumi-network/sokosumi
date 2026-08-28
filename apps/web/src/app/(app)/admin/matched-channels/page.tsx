import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { MatchedChannelsHub } from "@/components/admin/matched-channels/matched-channels-hub";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Matched channels",
  description: "Create org-less matched channels and manage their roster",
};

export default async function AdminMatchedChannelsPage() {
  const t = await getTranslations("App.Admin.MatchedChannels");

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin">{t("backToAdmin")}</Link>
          </Button>
        </div>

        <MatchedChannelsHub />
      </div>
    </div>
  );
}
