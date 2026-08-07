import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { DeveloperCoworkersSection } from "@/app/developer/components/coworkers";
import { DeveloperSectionContentSkeleton } from "@/app/developer/components/developer-loading-view";
import { DeveloperSectionShell } from "@/app/developer/components/developer-section-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Developer.tabs");
  return { title: t("coworkers") };
}

export default function DeveloperCoworkersPage() {
  return (
    <DeveloperSectionShell>
      <Suspense fallback={<DeveloperSectionContentSkeleton />}>
        <DeveloperCoworkersSection />
      </Suspense>
    </DeveloperSectionShell>
  );
}
