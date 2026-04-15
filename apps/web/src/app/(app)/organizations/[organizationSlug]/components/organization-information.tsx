import {
  type Member,
  MemberRole,
  type OrganizationWithRelations,
} from "@sokosumi/database";
import { getOrganizationMetadata } from "@sokosumi/utils";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { OrganizationLogo } from "@/components/organizations";
import { Avatar } from "@/components/ui/avatar";

import OrganizationCopyableId from "./organization-copyable-id";
import OrganizationEditButton from "./organization-edit-button";
import OrganizationRemoveButton from "./organization-remove-button";

interface OrganizationInformationProps {
  organization: OrganizationWithRelations;
  member: Member;
}

export default async function OrganizationInformation({
  organization,
  member,
}: OrganizationInformationProps) {
  const t = await getTranslations("App.Organizations.OrganizationDetail");
  const { role } = member;
  const isOwnerOrAdmin = role === MemberRole.OWNER || role === MemberRole.ADMIN;
  const { url: websiteUrl } = getOrganizationMetadata(organization.metadata);
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
            <OrganizationCopyableId value={organization.stripeCustomerId} />
          ),
        }
      : null,
  ].filter((card) => card !== null);

  return (
    <section className="rounded-3xl border border-border/60 bg-card/30 p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4 sm:gap-5">
          <Avatar className="bg-muted size-16 items-center justify-center rounded-2xl">
            <OrganizationLogo organization={organization} size={28} />
          </Avatar>
          <div className="min-w-0 space-y-2">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                {organization.name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t("slugLabel")}</span>
                <OrganizationCopyableId
                  value={organization.slug}
                  truncate={false}
                  codeClassName="bg-muted rounded-md px-2 py-1"
                  buttonClassName="size-7"
                />
              </div>
            </div>
          </div>
        </div>
        {isOwnerOrAdmin && (
          <div className="flex items-center gap-1.5 self-start">
            <OrganizationEditButton
              organization={organization}
              className="h-7 gap-1.5 px-2 text-xs"
            />
            <OrganizationRemoveButton
              organization={organization}
              className="h-7 gap-1.5 px-2 text-xs"
            />
          </div>
        )}
      </div>

      {detailCards.length > 0 ? (
        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          {detailCards.map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3"
            >
              <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {card.label}
              </dt>
              <dd className="mt-2 text-sm">{card.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
