import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getOAuthClientPublic, getSession } from "@/lib/auth/auth.server";

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
  const session = await getSession();

  if (!session?.session) {
    const queryString = oauthSearchParams.toString();
    redirect(queryString ? `/signin?${queryString}` : "/signin");
  }

  // Fetch public client info for display on consent page
  const clientResult = await getOAuthClientPublic(client_id);

  if (clientResult.isErr()) {
    return (
      <div className="container mx-auto max-w-md py-8">
        <CoreAuthReadRetry
          description={t("loadError.description")}
          retryLabel={t("loadError.retry")}
          title={t("loadError.title")}
        />
      </div>
    );
  }

  const client = clientResult.value;

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
