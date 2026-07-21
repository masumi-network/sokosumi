import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { CoworkersTable } from "@/components/admin/coworkers/coworkers-table";
import { adminCoworkerService } from "@/lib/services/admin-coworker.service";

export const metadata: Metadata = {
  title: "Coworkers",
  description: "Manage coworker display metadata",
};

export default async function AdminCoworkersPage() {
  const t = await getTranslations("App.Admin.Coworkers");

  let coworkers: Awaited<ReturnType<typeof adminCoworkerService.listCoworkers>>;
  try {
    coworkers = await adminCoworkerService.listCoworkers();
  } catch {
    return (
      <div className="min-h-full w-full">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <p className="text-destructive text-sm">{t("loadFailed")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        <CoworkersTable coworkers={coworkers} />
      </div>
    </div>
  );
}
