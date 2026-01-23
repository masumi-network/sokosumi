import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Maintenance");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function MaintenancePage() {
  const t = await getTranslations("Maintenance");

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-4xl font-bold">
            {t("title")}
          </CardTitle>
          <CardDescription className="text-center text-lg">
            {t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-center">
          <p>{t("message")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
