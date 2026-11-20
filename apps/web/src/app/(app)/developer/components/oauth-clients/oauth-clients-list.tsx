"use client";

import {
  hasCoreApiOAuthScope,
  hasOfflineAccessOAuthScope,
} from "@sokosumi/utils";
import { KeyRound, Pencil, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { DeveloperSectionRowsSkeleton } from "@/app/developer/components/developer-loading-view";
import { usePageListSearch } from "@/components/page-list-search";
import { Button } from "@/components/ui/button";

import type { OAuthClientsListProps } from "./types";
import { isPublicOAuthClient } from "./utils";

export function OAuthClientsList({
  clients,
  isInitialLoading,
  error,
  onRetry,
  onEditClick,
  onRotateClick,
  onDeleteClick,
}: OAuthClientsListProps) {
  const t = useTranslations("App.Account.OAuthClients");
  const format = useFormatter();

  const visible = usePageListSearch(clients, (client) => ({
    primary: [client.client_name, client.client_id],
    secondary: [
      ...(client.redirect_uris ?? []),
      t(isPublicOAuthClient(client) ? "Status.public" : "Status.confidential"),
      t(
        hasCoreApiOAuthScope(client.scope)
          ? "Status.apiAccess"
          : "Status.identityOnly",
      ),
      hasOfflineAccessOAuthScope(client.scope) ? t("Status.refresh") : null,
      client.disabled ? t("Status.disabled") : null,
    ],
  }));

  if (isInitialLoading) {
    return <DeveloperSectionRowsSkeleton />;
  }

  // Full error UI only when there is nothing useful to show. If a later
  // refresh fails but we still have clients (e.g. post-mutation), keep the
  // list and rely on the toast from the hook.
  if (error && clients.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-muted-foreground text-sm">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        {t("noClientsFound")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((client) => {
        const name = client.client_name || client.client_id;
        const issuedAt = client.client_id_issued_at
          ? format.dateTime(new Date(client.client_id_issued_at * 1000), {
              dateStyle: "medium",
            })
          : null;
        const allowsCoreApi = hasCoreApiOAuthScope(client.scope);
        const allowsOfflineAccess = hasOfflineAccessOAuthScope(client.scope);
        const isPublic = isPublicOAuthClient(client);

        return (
          <div
            key={client.client_id}
            // Phones: a full-width card with the actions at its foot. From md the
            // actions sit beside the details.
            className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-start md:justify-between md:gap-4"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 font-semibold break-words">{name}</p>
                <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                  {isPublic ? t("Status.public") : t("Status.confidential")}
                </span>
                <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                  {allowsCoreApi
                    ? t("Status.apiAccess")
                    : t("Status.identityOnly")}
                </span>
                {allowsOfflineAccess ? (
                  <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                    {t("Status.refresh")}
                  </span>
                ) : null}
                {client.disabled ? (
                  <span className="bg-quinary text-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                    {t("Status.disabled")}
                  </span>
                ) : null}
              </div>
              <div className="text-muted-foreground text-xs">
                <span className="font-medium">{t("clientIdLabel")}: </span>
                <span className="font-mono break-all">{client.client_id}</span>
              </div>
              {client.redirect_uris?.length ? (
                <div className="text-muted-foreground text-xs">
                  <span className="font-medium">
                    {t("redirectUrisLabel")}:{" "}
                  </span>
                  <span className="break-all">
                    {client.redirect_uris.join(", ")}
                  </span>
                </div>
              ) : null}
              {issuedAt ? (
                <p className="text-muted-foreground text-xs">
                  {t("created", { date: issuedAt })}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1 border-t pt-3 md:border-t-0 md:pt-0">
              <Button
                size="sm"
                variant="ghost"
                // DESIGN.md touch targets: 40px below md, 32px from md up.
                className="size-10 md:size-8"
                onClick={() => onEditClick(client)}
                title={t("Actions.editTooltip")}
                aria-label={t("Actions.editTooltip")}
              >
                <Pencil className="size-4" />
              </Button>
              {!isPublic ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-10 md:size-8"
                  onClick={() => onRotateClick(client)}
                  title={t("Actions.rotateTooltip")}
                  aria-label={t("Actions.rotateTooltip")}
                >
                  <KeyRound className="size-4" />
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="ms-auto size-10 md:ms-0 md:size-8"
                onClick={() => onDeleteClick(client)}
                title={t("Actions.deleteTooltip")}
                aria-label={t("Actions.deleteTooltip")}
              >
                <Trash2 className="text-destructive size-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
