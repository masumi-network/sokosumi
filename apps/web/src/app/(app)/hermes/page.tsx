import gravatarUrl from "gravatar-url";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import HermesExperience from "@/app/hermes/components/hermes-experience";
import LoadingState from "@/app/hermes/components/loading-state";
import { getSession } from "@/lib/auth/auth.server";
import { userService } from "@/lib/services/user.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Hermes.Metadata");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function HermesPage() {
  const session = await getSession();
  const userName = session?.user.name ?? null;
  const userEmail = session?.user.email ?? null;
  const userImageUrl = session?.user.image
    ? session.user.image
    : session?.user.email
      ? gravatarUrl(session.user.email, { size: 80, default: "404" })
      : null;

  // Org context for the confirmation-card dropdown (lets the user reroute
  // sokosumi_create_task / sokosumi_create_job into the right workspace
  // before approving). Empty list when not signed in or no memberships.
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const memberships = session
    ? await userService
        .getMyMembersWithOrganizations()
        .catch(
          () =>
            [] as Awaited<
              ReturnType<typeof userService.getMyMembersWithOrganizations>
            >,
        )
    : ([] as Awaited<
        ReturnType<typeof userService.getMyMembersWithOrganizations>
      >);
  const organizations = memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
  }));

  return (
    <Suspense fallback={<LoadingState />}>
      <HermesExperience
        userName={userName}
        userEmail={userEmail}
        userImageUrl={userImageUrl}
        organizations={organizations}
        activeOrganizationId={activeOrganizationId}
      />
    </Suspense>
  );
}
