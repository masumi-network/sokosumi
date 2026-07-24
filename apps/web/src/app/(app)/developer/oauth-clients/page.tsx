import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { DeveloperSectionShell } from "@/app/developer/components/developer-section-shell";
import { OAuthClientsSection } from "@/app/developer/components/oauth-clients";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Developer.tabs");
  return { title: t("oauthClients") };
}

export default function DeveloperOAuthClientsPage() {
  return (
    <DeveloperSectionShell>
      <OAuthClientsSection />
    </DeveloperSectionShell>
  );
}
