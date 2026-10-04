import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSignedInOAuthClient } from "@/lib/auth/oauth-request.server";

// Only ever reached by a full load from the verification email, so there is
// no client navigation to keep instant.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("EmailConfirmed");
  return { title: t("title") };
}

interface EmailConfirmedPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Where the verification email sends a person who signed up for another app
 * through Sign in with Sokosumi: Core's `/verify-email` redirects here, with
 * `error` when it refused the link. It sends them back to that app, not into
 * Sokosumi. Verifying signs them in, so Core's session-only lookup names the
 * app; `client_id` comes from the link and is never trusted beyond that.
 */
export default async function EmailConfirmedPage({
  searchParams,
}: EmailConfirmedPageProps) {
  const t = await getTranslations("EmailConfirmed");
  const { client_id: clientId, error } = await searchParams;
  const client =
    typeof clientId === "string"
      ? await getSignedInOAuthClient(clientId)
      : undefined;

  let message: string;
  if (error) {
    message = t("errorMessage");
  } else if (client) {
    message = t("messageFor", { client: client.name });
  } else {
    message = t("message");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-bold">
            <h1>{error ? t("errorTitle") : t("title")}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6 text-center text-muted-foreground">
          <p>{message}</p>
          {client?.uri ? (
            <Button asChild variant="primary">
              <Link href={client.uri}>
                {t("returnTo", { client: client.name })}
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
