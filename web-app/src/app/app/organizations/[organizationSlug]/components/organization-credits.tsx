import { Coins } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface OrganizationCreditsProps {
  credits: number;
  organizationName: string;
}

export default function OrganizationCredits({
  credits,
  organizationName,
}: OrganizationCreditsProps) {
  const t = useTranslations("App.Organizations.Credits");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{t("title")}</CardTitle>
        <Coins className="text-muted-foreground h-4 w-4" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-2xl font-bold">{credits.toFixed(2)}</div>
          <p className="text-muted-foreground text-xs">
            {t("description", { organization: organizationName })}
          </p>
        </div>
        <Button asChild size="sm" className="w-full">
          <Link href="/app/billing">{t("buy")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
