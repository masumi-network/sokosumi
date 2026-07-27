import { getTranslations } from "next-intl/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { OrganizationInviteLink } from "@/lib/clients/generated/core";

import { OrganizationInviteLinkForm } from "./organization-invite-link-form";
import { OrganizationInviteLinkList } from "./organization-invite-link-list";

interface OrganizationInviteLinksProps {
  organizationId: string;
  inviteLinks: OrganizationInviteLink[];
}

export async function OrganizationInviteLinks({
  organizationId,
  inviteLinks,
}: OrganizationInviteLinksProps) {
  const t = await getTranslations(
    "App.Organizations.OrganizationDetail.InviteLinks",
  );

  return (
    <Card id="invite-links">
      <CardHeader className="space-y-2">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t("listTitle")}</h3>
          <OrganizationInviteLinkList
            organizationId={organizationId}
            inviteLinks={inviteLinks}
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t("createFormTitle")}</h3>
          <OrganizationInviteLinkForm organizationId={organizationId} />
        </section>
      </CardContent>
    </Card>
  );
}
