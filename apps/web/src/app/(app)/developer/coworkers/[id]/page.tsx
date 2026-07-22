import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DeveloperCoworkerEditForm } from "@/app/developer/components/coworkers/developer-coworker-edit-form";
import { Button } from "@/components/ui/button";
import { developerCoworkerService } from "@/lib/services/developer-coworker.service";

export const metadata: Metadata = {
  title: "Edit coworker",
  description: "Edit owned coworker display fields",
};

interface DeveloperCoworkerEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function DeveloperCoworkerEditPage({
  params,
}: DeveloperCoworkerEditPageProps) {
  const { id } = await params;
  const t = await getTranslations("App.Developer.Coworkers");

  let coworker: Awaited<
    ReturnType<typeof developerCoworkerService.getOwnedCoworkerById>
  >;
  try {
    coworker = await developerCoworkerService.getOwnedCoworkerById(id);
  } catch {
    return (
      <div className="min-h-full w-full">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
          <Button variant="outline" asChild>
            <Link href="/developer?tab=coworkers">{t("backToList")}</Link>
          </Button>
          <p className="text-destructive text-sm">{t("loadFailed")}</p>
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {coworker.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("editDescription")}
            </p>
            <p className="text-muted-foreground font-mono text-xs">
              {coworker.slug}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/developer?tab=coworkers">{t("backToList")}</Link>
          </Button>
        </div>

        <DeveloperCoworkerEditForm coworker={coworker} />
      </div>
    </div>
  );
}
