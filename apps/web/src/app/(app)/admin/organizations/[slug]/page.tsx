import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrganizationDetailPanel } from "@/components/admin/organizations/organization-detail-panel";
import { adminOrganizationService } from "@/lib/services/admin-organization.service";
import { adminPreprodAccessService } from "@/lib/services/admin-preprod-access.service";

export const instant = false;

export const metadata: Metadata = {
  title: "Organization",
  description: "Admin organization overview",
};

interface AdminOrganizationDetailPageProps {
  params: Promise<{ slug: string }>;
}

export default async function AdminOrganizationDetailPage({
  params,
}: AdminOrganizationDetailPageProps) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const detail =
    await adminOrganizationService.getOrganizationOverview(decodedSlug);

  if (!detail) {
    notFound();
  }

  const [initialMembersPage, preprodAccess] = await Promise.all([
    adminOrganizationService.listOrganizationMembers(decodedSlug),
    adminPreprodAccessService.read({ type: "organization", slug: decodedSlug }),
  ]);

  if (preprodAccess.status === "missing") {
    notFound();
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl px-4 py-2">
        <OrganizationDetailPanel
          detail={detail}
          initialMembersPage={initialMembersPage}
          preprodAccess={
            preprodAccess.status === "found" ? preprodAccess.access : null
          }
        />
      </div>
    </div>
  );
}
