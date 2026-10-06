import {
  hasCoreApiOAuthScope,
  hasOfflineAccessOAuthScope,
} from "@sokosumi/utils";
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
import {
  buildSignedOAuthQueryFromSearchParams,
  readSearchParams,
  serializeOAuthSearchParams,
} from "@/lib/auth/auth.utils";

import { ConsentActions } from "./consent-actions";

export const instant = false;

interface ConsentPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const t = await getTranslations("App.Account.OAuthConsent");
  const oauthSearchParams = await readSearchParams(searchParams);

  const client_id = oauthSearchParams.get("client_id");
  const redirectQuery = serializeOAuthSearchParams(oauthSearchParams);
  const signedOAuthQuery =
    buildSignedOAuthQueryFromSearchParams(oauthSearchParams);
  const scope = oauthSearchParams.get("scope");
  const requestsCoreApi = hasCoreApiOAuthScope(scope);
  const requestsOfflineAccess = hasOfflineAccessOAuthScope(scope);

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

  const session = await getSession();

  if (!session?.session) {
    redirect(redirectQuery ? `/signin?${redirectQuery}` : "/signin");
  }

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
          <CardDescription>
            {requestsCoreApi ? t("descriptionWithApi") : t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="mb-1 font-semibold">
              {client.client_name || client.client_id}
            </p>
            <p className="text-muted-foreground text-sm">{t("wantsAccess")}</p>
            {requestsCoreApi ? (
              <p className="text-muted-foreground mt-2 text-sm">
                {t("apiAccessNotice")}
              </p>
            ) : null}
            {requestsOfflineAccess ? (
              <p className="text-muted-foreground mt-2 text-sm">
                {t("offlineAccessNotice")}
              </p>
            ) : null}
          </div>

          <ConsentActions oauthQuery={signedOAuthQuery} />
        </CardContent>
      </Card>
    </div>
  );
}
