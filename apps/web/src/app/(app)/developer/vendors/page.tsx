import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { DEVELOPER_DEFAULT_HREF } from "@/app/components/sidebar/components/developer-menu-config";
import { DeveloperSectionContentSkeleton } from "@/app/developer/components/developer-loading-view";
import { DeveloperSectionShell } from "@/app/developer/components/developer-section-shell";
import { DeveloperVendorsSection } from "@/app/developer/components/vendors";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Developer.tabs");
  return { title: t("vendors") };
}

export default async function DeveloperVendorsPage() {
  const { showVendors, adminVendors } = await getDeveloperVendorAdminAccess();
  if (!showVendors) {
    redirect(DEVELOPER_DEFAULT_HREF);
  }

  return (
    <DeveloperSectionShell>
      <Suspense fallback={<DeveloperSectionContentSkeleton />}>
        <DeveloperVendorsSection adminVendors={adminVendors} />
      </Suspense>
    </DeveloperSectionShell>
  );
}
