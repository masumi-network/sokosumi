import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CoworkerForm } from "@/components/admin/coworkers/coworker-form";
import { CoworkerLoadError } from "@/components/admin/coworkers/coworker-load-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminCoworkerService } from "@/lib/services/admin-coworker.service";

export const metadata: Metadata = {
  title: "Edit coworker",
  description: "Edit coworker display metadata",
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

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("editTitle")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("editDescription")}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin/coworkers">{t("backToList")}</Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{coworker.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <CoworkerForm coworker={coworker} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
