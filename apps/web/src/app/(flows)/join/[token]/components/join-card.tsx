import type { SessionUser } from "@sokosumi/utils";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { AlertCircle, Building2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

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
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <div className="bg-muted mb-2 flex size-16 items-center justify-center overflow-hidden rounded-2xl">
          {organization.logo ? (
            <Image
              src={resolveIpfsOrHttpUrl(organization.logo)}
              alt={organization.name}
              width={64}
              height={64}
              className="size-full object-cover"
            />
          ) : (
            <Building2 className="text-muted-foreground size-7" />
          )}
        </div>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <p className="text-muted-foreground text-sm">
          {t("invitedToJoin", { organization: organization.name })}
        </p>
      </CardHeader>
      <CardContent>
        <JoinActions
          token={token}
          organizationName={organization.name}
          organizationSlug={organization.slug}
          isAuthenticated={Boolean(user)}
        />
      </CardContent>
    </Card>
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
