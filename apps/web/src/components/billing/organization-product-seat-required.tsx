import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function OrganizationProductSeatRequired() {
  const t = await getTranslations("App.Sidebar.SeatRequired");

  return (
    <div className="flex w-full justify-center px-4 py-10">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-muted-foreground">{t("description")}</p>
          <p className="text-muted-foreground text-sm">{t("hint")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
