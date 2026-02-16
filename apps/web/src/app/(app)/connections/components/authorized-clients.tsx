"use client";

import { OAuthConsent, Scope } from "@better-auth/oauth-provider";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { revokeOAuthClientAccess } from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";

interface AuthorizedClientWithDetails extends OAuthConsent<Scope[]> {
  clientName?: string;
}

export function OAuthAuthorizedClients() {
  const t = useTranslations("App.Account.AuthorizedClients");
  const [consents, setConsents] = useState<AuthorizedClientWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    async function fetchConsents() {
      try {
        const result = await authClient.oauth2.getConsents();
        if (result.error) {
          throw new Error(result.error.message || t("fetchError"));
        }

        const consentsData = result.data || [];
        const consentsWithDetails: AuthorizedClientWithDetails[] =
          await Promise.all(
            consentsData.map(async (consent) => {
              try {
                const clientResult = await authClient.oauth2.getClient({
                  query: {
                    client_id: consent.clientId,
                  },
                });
                const clientName =
                  typeof clientResult.data?.client_name === "string"
                    ? clientResult.data.client_name
                    : consent.clientId;
                return {
                  ...consent,
                  clientName,
                };
              } catch {
                return {
                  ...consent,
                  clientName: consent.clientId,
                };
              }
            }),
          );

        setConsents(consentsWithDetails);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        setError(errorMessage);
        toast.error(errorMessage);
      } finally {
        setLoading(false);
      }
    }

    fetchConsents();
  }, [t]);

  async function handleRevoke(consentId: string, clientId: string) {
    if (!confirm(t("confirmRevoke"))) {
      return;
    }

    setRevoking(clientId);
    try {
      const result = await revokeOAuthClientAccess(consentId, clientId);

      if (!result.ok) {
        throw new Error(result.error.message || t("revokeError"));
      }

      setConsents(consents.filter((c) => c.clientId !== clientId));
      toast.success(t("revokeSuccess"));
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : t("revokeError");
      toast.error(errorMessage);
    } finally {
      setRevoking(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("loading")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("error", { error })}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {consents.length === 0 ? (
          <p className="text-muted-foreground">{t("noApplications")}</p>
        ) : (
          <div className="space-y-4">
            {consents.map((consent) => (
              <div
                key={consent.clientId}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="flex-1">
                  <p className="font-semibold">
                    {consent.clientName || consent.clientId}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("authorized", {
                      date: new Date(consent.createdAt).toLocaleDateString(),
                    })}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleRevoke(consent.id, consent.clientId)}
                  disabled={revoking === consent.clientId}
                >
                  {revoking === consent.clientId
                    ? t("revoking")
                    : t("revokeAccess")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
