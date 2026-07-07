import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function OrganizationBillingAccessRestricted() {
  const t = await getTranslations("App.Billing");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("orgAccessRestrictedTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-muted-foreground">
          {t("orgAccessRestrictedDescription")}
        </p>
        <p className="text-muted-foreground text-sm">
          {t("orgAccessRestrictedHint")}
        </p>
      </CardContent>
    </Card>
  );
}
