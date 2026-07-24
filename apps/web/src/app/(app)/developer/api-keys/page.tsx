import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ApiKeysSection } from "@/app/developer/components/api-keys";
import { DeveloperSectionShell } from "@/app/developer/components/developer-section-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Developer.tabs");
  return { title: t("apiKeys") };
}

export default function DeveloperApiKeysPage() {
  return (
    <DeveloperSectionShell>
      <ApiKeysSection />
    </DeveloperSectionShell>
  );
}
