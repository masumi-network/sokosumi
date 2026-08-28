import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ExternalChannelsHub } from "@/components/admin/external-channels/external-channels-hub";
import { Button } from "@/components/ui/button";
import { userService } from "@/lib/services/user.service";

export const metadata: Metadata = {
  title: "External channels",
  description: "Create External channels and add guests as a platform admin",
};

export default async function AdminExternalChannelsPage() {
  const t = await getTranslations("App.Admin.ExternalChannels");
  const memberships = await userService.getMyMembersWithOrganizations();
  const memberOrganizationIds = memberships.map(
    (membership) => membership.organizationId,
  );

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

        <ExternalChannelsHub memberOrganizationIds={memberOrganizationIds} />
      </div>
    </div>
  );
}
