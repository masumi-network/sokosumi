import { getTranslations } from "next-intl/server";

import { CoworkerAccessList } from "@/components/coworker-access/coworker-access-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";
import { coworkerAccessService } from "@/lib/services/coworker-access.service";
import { enrichCoworkerAccessEntries } from "@/lib/utils/enrich-coworker-access-entries";

interface OrganizationCoworkerAccessProps {
  organizationId: string;
}

export async function OrganizationCoworkerAccess({
  organizationId,
}: OrganizationCoworkerAccessProps) {
  const t = await getTranslations(
    "App.Organizations.OrganizationDetail.CoworkerAccess",
  );

  let rows: CoworkerWorkspaceAccess[] = [];
  try {
    rows = await coworkerAccessService.listForOrganization(organizationId);
  } catch (error) {
    console.error("Failed to load organization coworker access", error);
  }

  const entries = await enrichCoworkerAccessEntries(rows);

  return (
    <Card id="coworker-early-access">
      <CardHeader className="space-y-2">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t("coworkersTitle")}</h3>
          <CoworkerAccessList
            entries={entries}
            mode="organization"
            organizationId={organizationId}
            emptyLabel={t("coworkersEmpty")}
            namespace="App.Organizations.OrganizationDetail.CoworkerAccess"
          />
        </section>
      </CardContent>
    </Card>
  );
}
