import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth/auth";

import { ConsentActions } from "./consent-actions";

interface ConsentPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const t = await getTranslations("App.Account.OAuthConsent");
  const params = await searchParams;
  const oauthSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        oauthSearchParams.append(key, item);
      }
      continue;
    }

    if (value) {
      oauthSearchParams.set(key, value);
    }
  }

  const client_id = oauthSearchParams.get("client_id");

  if (!client_id) {
    return (
      <div className="container mx-auto max-w-md py-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("invalidRequest.title")}</CardTitle>
            <CardDescription>{t("invalidRequest.description")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Check if user is authenticated
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.session) {
    const queryString = oauthSearchParams.toString();
    redirect(queryString ? `/signin?${queryString}` : "/signin");
  }

  // Fetch public client info for display on consent page
  let client;
  try {
    client = await auth.api.getOAuthClientPublic({
      query: { client_id },
      headers: await headers(),
    });
  } catch (_error) {
    return (
      <div className="container mx-auto max-w-md py-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("clientNotFound.title")}</CardTitle>
            <CardDescription>{t("clientNotFound.description")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="container mx-auto max-w-md py-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("clientNotFound.title")}</CardTitle>
            <CardDescription>
              {t("clientNotFound.descriptionWithId", { clientId: client_id })}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-md py-8">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="mb-1 font-semibold">
              {(client.client_name as string | undefined) ||
                (client.client_id as string)}
            </p>
            <p className="text-muted-foreground text-sm">{t("wantsAccess")}</p>
          </div>

          <ConsentActions />
        </CardContent>
      </Card>
    </div>
  );
}
