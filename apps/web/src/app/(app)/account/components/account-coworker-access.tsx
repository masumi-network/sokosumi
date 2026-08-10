import { getTranslations } from "next-intl/server";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
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
import { toCoworkerAccessEntries } from "@/lib/utils/coworker-access-display";

export async function AccountCoworkerAccess() {
  const t = await getTranslations("App.Account.CoworkerAccess");

  let rows: CoworkerWorkspaceAccess[] = [];
  let loadFailed = false;
  try {
    rows = await coworkerAccessService.listForPersonalWorkspace();
  } catch (error) {
    loadFailed = true;
    console.error("Failed to load personal coworker access", error);
  }

  if (loadFailed) {
    return (
      <div id="coworker-early-access">
        <CoreAuthReadRetry
          description={t("loadError")}
          retryLabel={t("retry")}
          title={t("loadErrorTitle")}
        />
      </div>
    );
  }

  const entries = toCoworkerAccessEntries(rows);

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
            mode="personal"
            emptyLabel={t("coworkersEmpty")}
            namespace="App.Account.CoworkerAccess"
          />
        </section>
      </CardContent>
    </Card>
  );
}
