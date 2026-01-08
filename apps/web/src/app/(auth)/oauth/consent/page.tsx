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
  searchParams: Promise<{
    client_id?: string;
    redirect_uri?: string;
    code_challenge?: string;
    scope?: string;
    state?: string;
    response_type?: string;
  }>;
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const t = await getTranslations("App.Account.OAuthConsent");
  const params = await searchParams;
  const { client_id, redirect_uri, code_challenge, scope, state } = params;

  if (!client_id || !redirect_uri || !code_challenge) {
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
    // Redirect to OAuth sign-in with parameters preserved
    const signInParams = new URLSearchParams();
    if (client_id) signInParams.set("client_id", client_id);
    if (redirect_uri) signInParams.set("redirect_uri", redirect_uri);
    if (state) signInParams.set("state", state);
    if (scope) signInParams.set("scope", scope);
    redirect(`/oauth/sign-in?${signInParams.toString()}`);
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

  const scopes = scope?.split(" ") || [];

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

          {scopes.length > 0 && (
            <div>
              <p className="mb-2 font-semibold">{t("requestedPermissions")}</p>
              <ul className="list-inside list-disc space-y-1 text-sm">
                {scopes.map((s) => {
                  let description: string;
                  if (s === "read") {
                    description = t("scopes.read");
                  } else if (s === "write") {
                    description = t("scopes.write");
                  } else if (s === "admin") {
                    description = t("scopes.admin");
                  } else {
                    description = s;
                  }
                  return (
                    <li key={s} className="text-muted-foreground">
                      {description}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <ConsentActions redirectUri={redirect_uri} />
        </CardContent>
      </Card>
    </div>
  );
}
