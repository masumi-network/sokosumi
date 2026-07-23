import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { DeveloperSectionShell } from "@/app/developer/components/developer-section-shell";
import { DocsSection } from "@/app/developer/components/docs-section";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Developer.tabs");
  return { title: t("docs") };
}

export default function DeveloperDocsPage() {
  return (
    <DeveloperSectionShell>
      <Suspense fallback={null}>
        <DocsSection />
      </Suspense>
    </DeveloperSectionShell>
  );
}
