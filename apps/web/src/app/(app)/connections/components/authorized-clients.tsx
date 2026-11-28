"use client";

import type { OAuthConsent, Scope } from "@better-auth/oauth-provider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { usePageListSearch } from "@/components/page-list-search";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { revokeOAuthClientAccess } from "@/lib/actions/oauth/action";
import { authClient } from "@/lib/auth/auth.client";

interface AuthorizedClientWithDetails extends OAuthConsent<Scope[]> {
  clientName?: string;
}

type OAuthConsentItem = OAuthConsent<Scope[]>;

const AUTHORIZED_CLIENTS_QUERY_KEY = ["connections", "oauth-consents"] as const;

async function loadAuthorizedClients(): Promise<AuthorizedClientWithDetails[]> {
  const result = await authClient.oauth2.getConsents();
  if (result.error) {
    throw new Error(result.error.message);
  }

  const consentsData: OAuthConsentItem[] = result.data || [];
  return await Promise.all(
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
}

/** What the polite status region says about the list read. */
function loadStatusKey({
  hasData,
  failedBefore,
  fetching,
}: {
  hasData: boolean;
  failedBefore: boolean;
  fetching: boolean;
}) {
  if (!hasData && fetching) return "loadingStatus";
  if (!hasData && failedBefore) return "loadErrorTitle";
  return hasData ? "loadedStatus" : null;
}

function AuthorizedClientsLoadingRows() {
  return (
    <CardContent
      data-testid="authorized-clients-loading"
      aria-busy="true"
      className="space-y-4"
    >
      {Array.from({ length: 2 }, (_, index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-4 rounded-lg border p-4"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-28 max-w-full" />
          </div>
          <Skeleton className="h-8 w-28 shrink-0 rounded-md" />
        </div>
      ))}
    </CardContent>
  );
}

export function OAuthAuthorizedClients() {
  const t = useTranslations("App.Account.AuthorizedClients");
  const formatter = useFormatter();
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<string | null>(null);

  const consentsQuery = useQuery({
    queryKey: AUTHORIZED_CLIENTS_QUERY_KEY,
    retry: false,
    // Default gcTime keeps the list across tab switches; staleTime 0 still
    // refreshes it in the background on every return.
    staleTime: 0,
    networkMode: "always",
    refetchOnWindowFocus: false,
    queryFn: loadAuthorizedClients,
  });

  const consents = consentsQuery.data ?? [];
  const hasData = consentsQuery.data !== undefined;
  const failedBefore = consentsQuery.errorUpdateCount > 0;
  // A retry puts the query back to pending; keep the retry card (and the
  // focused button) mounted until data arrives.
  const loadFailed = !hasData && failedBefore;
  const loading = !hasData && !loadFailed;
  const statusKey = loadStatusKey({
    hasData,
    failedBefore,
    fetching: consentsQuery.isFetching,
  });

  const visible = usePageListSearch(consents, (consent) => ({
    primary: [consent.clientName, consent.clientId],
  }));
  // The page filter matched none: its own "No matches" says so, not an empty body.
  const filteredOut = consents.length > 0 && visible.length === 0;

  async function handleRevoke(consentId: string, clientId: string) {
    if (!confirm(t("confirmRevoke"))) {
      return;
    }

    setRevoking(clientId);
    try {
      await queryClient.cancelQueries({
        queryKey: AUTHORIZED_CLIENTS_QUERY_KEY,
      });
      const result = await revokeOAuthClientAccess(consentId, clientId);

      if (!result.ok) {
        throw new Error(result.error.message || t("revokeError"));
      }

      await queryClient.cancelQueries({
        queryKey: AUTHORIZED_CLIENTS_QUERY_KEY,
      });
      queryClient.setQueryData<AuthorizedClientWithDetails[]>(
        AUTHORIZED_CLIENTS_QUERY_KEY,
        (current) => (current ?? []).filter((c) => c.clientId !== clientId),
      );
      toast.success(t("revokeSuccess"));
      await consentsQuery.refetch();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : t("revokeError");
      toast.error(errorMessage);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <>
      <p role="status" className="sr-only">
        {statusKey ? t(statusKey) : null}
      </p>
      {loadFailed ? (
        <CoreAuthReadRetry
          description={t("loadError")}
          onRetry={() => consentsQuery.refetch()}
          retryLabel={t("retry")}
          retrying={consentsQuery.isFetching}
          title={t("loadErrorTitle")}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </CardHeader>
          {loading ? (
            <AuthorizedClientsLoadingRows />
          ) : filteredOut ? null : (
            <CardContent>
              {consents.length === 0 ? (
                <p className="text-muted-foreground">{t("noApplications")}</p>
              ) : (
                <div className="space-y-4">
                  {visible.map((consent) => (
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
                            date: formatter.dateTime(
                              new Date(consent.createdAt),
                              {
                                dateStyle: "medium",
                              },
                            ),
                          })}
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() =>
                          handleRevoke(consent.id, consent.clientId)
                        }
                        loading={revoking === consent.clientId}
                      >
                        {t("revokeAccess")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}
    </>
  );
}
