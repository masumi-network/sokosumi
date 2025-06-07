"use client";

import { Invitation } from "better-auth/plugins";
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

interface InvitationCardProps {
  invitation: Invitation & {
    organizationName: string;
    organizationSlug: string;
    inviterEmail: string;
  };
}

export default function InvitationCard({ invitation }: InvitationCardProps) {
  const t = useTranslations("App.AcceptInvitation.InvitationCard");
  const { status, organizationName, inviterEmail, email } = invitation;

  const handleAccept = async () => {};

  const handleReject = async () => {};

  return (
    <Card className="w-full max-w-md">
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
            <p>
              {t("thisInvitationWasSentTo")} <strong>{email}</strong>
            </p>
          </div>
        )}
        {status === "accepted" && (
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckIcon className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-center text-2xl font-bold">
              {t("acceptedTitle", {
                organizationName: invitation.organizationName,
              })}
            </h2>
            <p className="text-center">{t("acceptedDescription")}</p>
          </div>
        )}
        {status === "rejected" && (
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <XIcon className="h-8 w-8 text-red-600" />
            </div>
            <h2 className="text-center text-2xl font-bold">
              {t("declinedTitle")}
            </h2>
            <p className="text-center">
              {t("declinedDescription", {
                organizationName: organizationName,
              })}
            </p>
          </div>
        )}
      </CardContent>
      {status === "pending" && (
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={handleReject}>
            {t("decline")}
          </Button>
          <Button onClick={handleAccept}>{t("accept")}</Button>
        </CardFooter>
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

export function InvitationErrorCard() {
  const t = useTranslations("App.AcceptInvitation.InvitationCard.Error");

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
        <Link href="/app" className="w-full">
          <Button variant="outline" className="w-full">
            {t("footer")}
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
