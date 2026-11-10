"use client";

import type { OAuthConsent, Scope } from "@better-auth/oauth-provider";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { revokeOAuthClientAccess } from "@/lib/actions/oauth/action";
import { authClient } from "@/lib/auth/auth.client";

interface AuthorizedClientWithDetails extends OAuthConsent<Scope[]> {
  clientName?: string;
}

type OAuthConsentItem = OAuthConsent<Scope[]>;

export function OAuthAuthorizedClients() {
  const t = useTranslations("App.Account.AuthorizedClients");
  const formatter = useFormatter();
  const [consents, setConsents] = useState<AuthorizedClientWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] =
    useState<AuthorizedClientWithDetails | null>(null);
  // The dialog opens from a row's button rather than an AlertDialogTrigger,
  // so Radix has nothing to hand focus back to. Remember the opener's row.
  const openerIndex = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);

  function restoreFocus(event: Event) {
    event.preventDefault();
    // Cancel or Escape: the opener is still there. After a revoke its row is
    // gone, so the row that took its place (or the one above, or the empty
    // message) gets focus.
    const buttons =
      contentRef.current?.querySelectorAll<HTMLElement>("[data-revoke]") ?? [];
    const target =
      buttons[Math.min(openerIndex.current, buttons.length - 1)] ??
      contentRef.current?.querySelector<HTMLElement>("[data-empty]");
    target?.focus();
  }

  useEffect(() => {
    async function fetchConsents() {
      try {
        const result = await authClient.oauth2.getConsents();
        if (result.error) {
          throw new Error(result.error.message || t("fetchError"));
        }

        const consentsData: OAuthConsentItem[] = result.data || [];
        const consentsWithDetails: AuthorizedClientWithDetails[] =
          await Promise.all(
            consentsData.map(async (consent: OAuthConsentItem) => {
              try {
                // `getClient` answers only the app's owner, so an app the
                // viewer authorized but does not own came back 401 and showed
                // as its raw id. The public fields carry the name for anyone.
                const clientResult = await authClient.oauth2.publicClient({
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
    setRevoking(clientId);
    try {
      const result = await revokeOAuthClientAccess(consentId, clientId);

      if (!result.ok) {
        throw new Error(result.error.message || t("revokeError"));
      }

      setConsents(consents.filter((c) => c.clientId !== clientId));
      setRevokeTarget(null);
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
      <CardContent ref={contentRef}>
        {consents.length === 0 ? (
          <p data-empty tabIndex={-1} className="text-muted-foreground">
            {t("noApplications")}
          </p>
        ) : (
          <div className="space-y-4">
            {consents.map((consent, index) => (
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
                      date: formatter.dateTime(new Date(consent.createdAt), {
                        dateStyle: "medium",
                      }),
                    })}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  data-revoke
                  onClick={() => {
                    openerIndex.current = index;
                    setRevokeTarget(consent);
                  }}
                  loading={revoking === consent.clientId}
                >
                  {t("revokeAccess")}
                </Button>
              </div>
            ))}
          </div>
        )}
        <AlertDialog
          open={revokeTarget !== null}
          onOpenChange={(open) => {
            if (!open && revoking === null) {
              setRevokeTarget(null);
            }
          }}
        >
          <AlertDialogContent onCloseAutoFocus={restoreFocus}>
            <AlertDialogHeader>
              <AlertDialogTitle className="break-words">
                {t("confirmRevoke", {
                  name: revokeTarget?.clientName ?? "",
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("confirmRevokeDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={revoking !== null}>
                {t("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                loading={revoking !== null}
                className="bg-semantic-destructive-solid text-semantic-destructive-foreground hover:bg-destructive-hover"
                onClick={(event) => {
                  event.preventDefault();
                  if (revokeTarget) {
                    void handleRevoke(revokeTarget.id, revokeTarget.clientId);
                  }
                }}
              >
                {t("revokeAccess")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
