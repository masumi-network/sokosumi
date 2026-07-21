import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CoworkerForm } from "@/components/admin/coworkers/coworker-form";
import { CoworkerLoadError } from "@/components/admin/coworkers/coworker-load-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminCoworkerService } from "@/lib/services/admin-coworker.service";

export const metadata: Metadata = {
  title: "Edit coworker",
  description: "Edit coworker platform controls and display metadata",
};

interface AdminCoworkerDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminCoworkerDetailPage({
  params,
}: AdminCoworkerDetailPageProps) {
  const { id } = await params;
  const t = await getTranslations("App.Admin.Coworkers");

  let coworker: Awaited<
    ReturnType<typeof adminCoworkerService.getCoworkerById>
  >;
  try {
    coworker = await adminCoworkerService.getCoworkerById(id);
  } catch {
    return (
      <div className="min-h-full w-full">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
          <Button variant="outline" asChild>
            <Link href="/admin/coworkers">{t("backToList")}</Link>
          </Button>
          <CoworkerLoadError />
        </div>
      </div>
    );
  }

  if (!coworker) {
    notFound();
  }

  const isArchived = coworker.archivedAt != null;

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {coworker.name}
              </h1>
              {isArchived ? (
                <Badge variant="secondary">{t("Context.archived")}</Badge>
              ) : (
                <Badge variant="outline">{t("Context.active")}</Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {t("editDescription")}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin/coworkers">{t("backToList")}</Link>
          </Button>
        </div>

        <CoworkerForm coworker={coworker} />
      </div>
    </div>
  );
}
