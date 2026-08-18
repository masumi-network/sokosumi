import type { SessionUser } from "@sokosumi/utils";
import { AlertCircle, CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { OrganizationInviteCard } from "@/components/auth/organization-invite-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PendingInvitationErrorCode } from "@/lib/services";
import type { PendingInvitationDetail } from "@/lib/services/organization.service";

import InvitationActions from "./invitation-actions";

interface InvitationCardProps {
  invitation: PendingInvitationDetail;
  user?: SessionUser;
}

export default function InvitationCard({
  invitation,
  user,
}: InvitationCardProps) {
  const t = useTranslations("AcceptInvitation.InvitationCard");
  const { status, inviter, organization } = invitation;

  if (status === "pending") {
    return (
      <OrganizationInviteCard
        organization={{ name: organization.name }}
        title={t("title")}
        description={
          <>
            <p>{t("invitedToJoin", { organization: organization.name })}</p>
            <p>
              <strong>{inviter.email}</strong> {t("hasInvitedYouToJoin")}
            </p>
          </>
        }
      >
        <InvitationActions
          invitation={invitation}
          organizationSlug={organization.slug}
          user={user}
        />
      </OrganizationInviteCard>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardContent>
        {status === "accepted" && (
          <div className="space-y-4">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-100">
              <CheckIcon className="size-8 text-green-600" />
            </div>
            <h1 className="text-center text-2xl font-light">
              {t("acceptedTitle", {
                organizationName: organization.name,
              })}
            </h1>
            <p className="text-center">
              {t("acceptedDescription", {
                organizationName: organization.name,
              })}
            </p>
            <Button variant="outline" asChild className="w-full">
              <Link
                href={`/organizations/${encodeURIComponent(organization.slug)}`}
              >
                {t("goToOrganization")}
              </Link>
            </Button>
          </div>
        )}
        {status === "rejected" && (
          <div className="space-y-4">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-red-100">
              <XIcon className="size-8 text-red-600" />
            </div>
            <h1 className="text-center text-2xl font-light">
              {t("declinedTitle")}
            </h1>
            <p className="text-center">
              {t("declinedDescription", {
                organizationName: organization.name,
              })}
            </p>
            <Button variant="outline" asChild className="w-full">
              <Link href="/">{t("goToHome")}</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function InvitationCardSkeleton() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="flex flex-col items-center text-center">
        <Skeleton className="mb-2 size-16 rounded-2xl" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-56" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

export function InvitationErrorCard({
  errorCode,
}: {
  errorCode: PendingInvitationErrorCode;
}) {
  const t = useTranslations(
    getTranslationPathForInvitationErrorCode(errorCode),
  );

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertCircle className="text-destructive size-6" />
          <CardTitle className="text-destructive text-xl">
            {t("title")}
          </CardTitle>
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">{t("content")}</p>
        <Button variant="outline" asChild className="w-full">
          <Link href="/">{t("footer")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function getTranslationPathForInvitationErrorCode(
  errorCode: PendingInvitationErrorCode,
) {
  switch (errorCode) {
    case PendingInvitationErrorCode.NOT_FOUND:
      return "AcceptInvitation.InvitationErrorCard.NotFound";
    case PendingInvitationErrorCode.EXPIRED:
      return "AcceptInvitation.InvitationErrorCard.Expired";
    case PendingInvitationErrorCode.INVITER_NOT_FOUND:
      return "AcceptInvitation.InvitationErrorCard.InviterNotFound";
  }
}
