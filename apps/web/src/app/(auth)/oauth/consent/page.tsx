import {
  AppWindow,
  ArrowRight,
  KeyRound,
  type LucideIcon,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { SokosumiIcon } from "@/components/masumi-logos";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getOAuthClientPublic, getSession } from "@/lib/auth/auth.server";
import {
  buildSignedOAuthConsentQueryFromSearchParams,
  serializeOAuthConsentSearchParams,
} from "@/lib/auth/auth.utils";

import { ConsentActions } from "./consent-actions";
import { getOAuthConsentScopeFlags } from "./oauth-consent-scope-flags";

interface PermissionRowProps {
  icon: LucideIcon;
  title: string;
  description: string;
  scope: string;
}

function PermissionRow({
  icon: Icon,
  title,
  description,
  scope,
}: PermissionRowProps) {
  return (
    <div className="flex items-start gap-3 p-4">
      <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
        <Icon aria-hidden className="size-4" />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground text-sm leading-5">{description}</p>
        <code className="bg-muted text-foreground/70 inline-block rounded-md px-1.5 py-0.5 font-mono text-xs">
          {scope}
        </code>
      </div>
    </div>
  );
}

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
  const redirectQuery = serializeOAuthConsentSearchParams(oauthSearchParams);
  const signedOAuthQuery =
    buildSignedOAuthConsentQueryFromSearchParams(oauthSearchParams);
  const { requestsCoreApi, requestsOfflineAccess } = getOAuthConsentScopeFlags(
    oauthSearchParams.get("scope"),
  );

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
    redirect(redirectQuery ? `/signin?${redirectQuery}` : "/signin");
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
    <div className="container mx-auto flex max-w-md justify-center px-4 py-8 sm:py-12">
      <Card className="w-full shadow-sm">
        <CardHeader className="border-b bg-muted/30 pb-6">
          <div className="flex items-center gap-3">
            <div className="bg-secondary text-secondary-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
              <AppWindow aria-hidden className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium">
                {client.client_name || client.client_id}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t("clientLabel")}
              </p>
            </div>
            <ArrowRight
              aria-hidden
              className="text-muted-foreground ml-auto size-4 shrink-0"
            />
            <div className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
              <SokosumiIcon animated={false} className="size-5" />
            </div>
          </div>
          <CardTitle className="text-balance text-xl font-light tracking-tight md:text-2xl">
            {t("title")}
          </CardTitle>
          <CardDescription className="text-pretty leading-6">
            {requestsCoreApi ? t("descriptionWithApi") : t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {requestsCoreApi || requestsOfflineAccess ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">{t("permissionsLabel")}</p>
              <div className="divide-y overflow-hidden rounded-lg border">
                {requestsCoreApi ? (
                  <PermissionRow
                    description={t("apiAccessDescription")}
                    icon={KeyRound}
                    scope={t("apiAccessScope")}
                    title={t("apiAccessTitle")}
                  />
                ) : null}
                {requestsOfflineAccess ? (
                  <PermissionRow
                    description={t("offlineAccessDescription")}
                    icon={RefreshCw}
                    scope={t("offlineAccessScope")}
                    title={t("offlineAccessTitle")}
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="border-primary/15 bg-primary/5 flex items-start gap-3 rounded-lg border p-4">
            <ShieldCheck
              aria-hidden
              className="text-primary mt-0.5 size-4 shrink-0"
            />
            <p className="text-sm leading-5">{t("securityNotice")}</p>
          </div>

          <ConsentActions oauthQuery={signedOAuthQuery} />
        </CardContent>
      </Card>
    </div>
  );
}
