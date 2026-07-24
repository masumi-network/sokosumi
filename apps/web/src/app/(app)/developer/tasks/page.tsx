import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { DeveloperSectionShell } from "@/app/developer/components/developer-section-shell";
import { DeveloperTasksSection } from "@/app/developer/components/tasks";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Developer.tabs");
  return { title: t("tasks") };
}

export default function DeveloperTasksPage() {
  return (
    <DeveloperSectionShell>
      <Suspense fallback={null}>
        <DeveloperTasksSection />
      </Suspense>
    </DeveloperSectionShell>
  );
}
