import { getOrganizationMetadata, MemberRole } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import {
  DesignMdLoadError,
  fetchDesignMdMarkdown,
} from "@/components/design-md/design-md-edit-page-shared";
import { DesignMdEditor } from "@/components/design-md-editor/design-md-editor";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import { userService } from "@/lib/services";

interface OrganizationDesignMdEditPageProps {
  params: Promise<{ organizationSlug: string }>;
}

async function getMemberOrganizationBySlug(slug: string) {
  try {
    const response = await coreClient.getOrganizationBySlug(slug);
    return response?.data ?? null;
  } catch (error) {
    if (
      error instanceof CoreApiRequestError &&
      (error.status === 401 || error.status === 403)
    ) {
      return null;
    }
    throw error;
  }
}

export default async function OrganizationDesignMdEditPage({
  params,
}: OrganizationDesignMdEditPageProps) {
  const t = await getTranslations("App.DesignMd");
  const { organizationSlug } = await params;
  const normalizedSlug = decodeURIComponent(organizationSlug);
  const returnHref = `/organizations/${normalizedSlug}`;

  const organization = await getMemberOrganizationBySlug(normalizedSlug);
  if (!organization) {
    return (
      <DesignMdLoadError
        backHref="/"
        backLabel={t("editBackToProfile")}
        description={t("editLoadErrorDescription")}
        title={t("editUnavailableTitle")}
      />
    );
  }

  const member = await userService.getMyMemberInOrganization(organization.id);
  const isOwnerOrAdmin =
    member?.role === MemberRole.OWNER || member?.role === MemberRole.ADMIN;
  if (!isOwnerOrAdmin) {
    return (
      <DesignMdLoadError
        backHref={returnHref}
        backLabel={t("editBackToProfile")}
        description={t("editLoadErrorDescription")}
        title={t("editUnavailableTitle")}
      />
    );
  }

  const organizationMetadata = getOrganizationMetadata(organization.metadata);
  const designMdUrl = organizationMetadata.designMdUrl;

  if (!designMdUrl) {
    return (
      <DesignMdLoadError
        backHref={returnHref}
        backLabel={t("editBackToProfile")}
        description={t("editLoadErrorDescription")}
        title={t("editUnavailableTitle")}
      />
    );
  }

  const loadResult = await fetchDesignMdMarkdown(designMdUrl);

  if ("error" in loadResult) {
    return (
      <DesignMdLoadError
        backHref={returnHref}
        backLabel={t("editBackToProfile")}
        description={t("editLoadErrorDescription")}
        title={t("editLoadErrorTitle")}
      />
    );
  }

  return (
    <DesignMdEditor
      initialMarkdown={loadResult.markdown}
      owner={{ type: "organization", organizationId: organization.id }}
      returnHref={returnHref}
    />
  );
}
