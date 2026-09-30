import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AppleAppCallback");
  return { title: t("title") };
}

/**
 * Where Core sends the Sokosumi Apple app after sign-in. The system browser
 * hands this URL to the app before it loads, so the page is only seen when
 * that did not happen. It takes no search params: the authorization code in
 * the URL belongs to the app and is never read here.
 */
export default async function AppleAppCallbackPage() {
  const t = await getTranslations("AppleAppCallback");

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-bold">
            <h1>{t("title")}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-center">
          <p>{t("message")}</p>
        </CardContent>
      </Card>
    </main>
  );
}
