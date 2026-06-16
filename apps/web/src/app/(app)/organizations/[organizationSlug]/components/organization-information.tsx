import { getOrganizationMetadata, MemberRole } from "@sokosumi/utils";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CopyableValue } from "@/components/copyable-value";
import { OrganizationLogo } from "@/components/organizations";
import { Avatar } from "@/components/ui/avatar";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { MemberRecord } from "@/lib/clients/generated/core";
import { toDesignMdProfileValue } from "@/lib/helpers/design-md-profile";
import { designMdService } from "@/lib/services/design-md.service";
import type { OrganizationRecord } from "@/lib/types/core-dto";
import { OrganizationDesignMdSection } from "./organization-design-md-section";
import OrganizationEditButton from "./organization-edit-button";
import { OrganizationMetadataProvider } from "./organization-metadata-context";
import OrganizationRemoveButton from "./organization-remove-button";

interface OrganizationInformationProps {
  organization: OrganizationRecord;
  member: MemberRecord;
}

export default async function OrganizationInformation({
  organization,
  member,
}: OrganizationInformationProps) {
  const t = await getTranslations("App.Organizations.OrganizationDetail");
  const { role } = member;
  const isOwnerOrAdmin = role === MemberRole.OWNER || role === MemberRole.ADMIN;
  const organizationMetadata = getOrganizationMetadata(organization.metadata);
  const { url: websiteUrl } = organizationMetadata;
  const designMdValue = toDesignMdProfileValue(
    organizationMetadata,
    designMdService.getDesignMdPreviewUrl,
  );
  const detailCards = [
    websiteUrl
      ? {
          label: t("websiteLabel"),
          value: (
            <Link
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary break-all underline-offset-4 hover:underline"
            >
              {websiteUrl}
            </Link>
          ),
        }
      : null,
    organization.stripeCustomerId
      ? {
          label: t("stripeCustomerIdLabel"),
          value: (
            <CopyableValue
              value={organization.stripeCustomerId}
              copiedFeedback
              presentation="inline-code"
            />
          ),
        }
      : null,
  ].filter((card) => card !== null);

  return (
    <OrganizationMetadataProvider organization={organization}>
      <Card className="shadow-none">
        <CardHeader className="gap-6">
          <div className="flex items-center gap-4 sm:gap-5">
            <Avatar className="bg-muted size-16 items-center justify-center rounded-2xl">
              <OrganizationLogo organization={organization} size={28} />
            </Avatar>
            <div className="min-w-0 space-y-2">
              <div className="space-y-1">
                <CardTitle>
                  <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                    {organization.name}
                  </h1>
                </CardTitle>
                <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {t("slugLabel")}
                  </span>
                  <CopyableValue
                    value={organization.slug}
                    copiedFeedback
                    presentation="inline-code"
                    truncateInline={false}
                    codeClassName="bg-muted rounded-md px-2 py-1"
                    buttonClassName="size-7"
                  />
                </div>
              </div>
            </div>
          </div>
          {isOwnerOrAdmin && (
            <CardAction>
              <div className="flex items-center gap-1.5">
                <OrganizationEditButton
                  organization={organization}
                  className="h-7 gap-1.5 px-2 text-xs"
                />
                <OrganizationRemoveButton
                  organization={organization}
                  className="h-7 gap-1.5 px-2 text-xs"
                />
              </div>
            </CardAction>
          )}
        </CardHeader>

        {detailCards.length > 0 ? (
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              {detailCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4"
                >
                  <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {card.label}
                  </dt>
                  <dd className="mt-3 text-sm">{card.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        ) : null}
      </Card>
      <OrganizationDesignMdSection
        owner={{ type: "organization", organizationId: organization.id }}
        canManage={isOwnerOrAdmin}
        value={designMdValue}
        websiteUrl={websiteUrl}
      />
    </OrganizationMetadataProvider>
  );
}
