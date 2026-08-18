import type { SessionUser } from "@sokosumi/utils";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { OrganizationInviteCard } from "@/components/auth/organization-invite-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { JoinActions } from "./join-actions";

interface JoinOrganizationPreview {
  name: string;
  slug: string;
  logo: string | null;
}

interface JoinCardProps {
  token: string;
  organization: JoinOrganizationPreview;
  user?: SessionUser;
}

export function JoinCard({ token, organization, user }: JoinCardProps) {
  const t = useTranslations("Join");

  return (
    <OrganizationInviteCard
      organization={organization}
      title={t("title")}
      description={
        <p>{t("invitedToJoin", { organization: organization.name })}</p>
      }
    >
      <JoinActions
        token={token}
        organizationName={organization.name}
        organizationSlug={organization.slug}
        isAuthenticated={Boolean(user)}
        currentUserName={user?.name?.trim() ?? ""}
      />
    </OrganizationInviteCard>
  );
}

export function JoinInvalidCard({
  status,
}: {
  status: "valid" | "expired" | "revoked" | "depleted" | "not_found";
}) {
  const t = useTranslations("Join");

  const messageKey =
    status === "expired"
      ? "Invalid.expired"
      : status === "revoked"
        ? "Invalid.revoked"
        : status === "depleted"
          ? "Invalid.depleted"
          : "Invalid.notFound";

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertCircle className="text-destructive size-6" />
          <CardTitle className="text-destructive text-xl">
            {t("Invalid.title")}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">{t(messageKey)}</p>
        <Button variant="outline" asChild className="w-full">
          <Link href="/">{t("Invalid.back")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
