import { InvitationWithRelations } from "@sokosumi/database";
import { User } from "better-auth";
import { AlertCircle, CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PendingInvitationErrorCode } from "@/lib/services";

import InvitationActions from "./invitation-actions";

interface InvitationCardProps {
  invitation: InvitationWithRelations;
  user?: User | undefined;
}

export default function InvitationCard({
  invitation,
  user,
}: InvitationCardProps) {
  const t = useTranslations("AcceptInvitation.InvitationCard");
  const { status, organization, inviter } = invitation;
  const { name: organizationName, slug: organizationSlug } = organization;
  const { email: inviterEmail } = inviter;

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {status === "pending" && (
          <div className="space-y-4">
            <p>
              <strong>{inviterEmail}</strong> {t("hasInvitedYouToJoin")}{" "}
              <strong>{organizationName}</strong>
            </p>
          </div>
        )}
        {status === "accepted" && (
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckIcon className="h-8 w-8 text-green-600" />
            </div>
            <h1 className="text-center text-2xl font-light">
              {t("acceptedTitle", {
                organizationName,
              })}
            </h1>
            <p className="text-center">
              {t("acceptedDescription", {
                organizationName,
              })}
            </p>
            <Button variant="outline" asChild className="w-full">
              <Link
                href={`/organizations/${encodeURIComponent(organizationSlug)}`}
              >
                {t("goToOrganization")}
              </Link>
            </Button>
          </div>
        )}
        {status === "rejected" && (
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <XIcon className="h-8 w-8 text-red-600" />
            </div>
            <h1 className="text-center text-2xl font-light">
              {t("declinedTitle")}
            </h1>
            <p className="text-center">
              {t("declinedDescription", {
                organizationName,
              })}
            </p>
            <Button variant="outline" asChild className="w-full">
              <Link href="/">{t("goToHome")}</Link>
            </Button>
          </div>
        )}
      </CardContent>
      {status === "pending" && (
        <InvitationActions invitation={invitation} user={user} />
      )}
    </Card>
  );
}

export function InvitationCardSkeleton() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex items-center space-x-2">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-6 w-24" />
        </div>
        <Skeleton className="mt-2 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-2/3" />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </CardContent>
      <CardFooter className="flex justify-end">
        <Skeleton className="h-10 w-24" />
      </CardFooter>
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
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <div className="flex items-center space-x-2">
          <AlertCircle className="text-destructive h-6 w-6" />
          <CardTitle className="text-destructive text-xl">
            {t("title")}
          </CardTitle>
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4 text-sm">{t("content")}</p>
      </CardContent>
      <CardFooter>
        <Link href="/" className="w-full">
          <Button variant="outline" className="w-full">
            {t("footer")}
          </Button>
        </Link>
      </CardFooter>
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
