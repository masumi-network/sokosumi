"use client";

import { KeyRound, Pencil, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import type { OAuthClientsListProps } from "./types";

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

  if (isInitialLoading) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        {t("loading")}
      </div>
    );
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
      {clients.map((client) => {
        const name = client.client_name || client.client_id;
        const issuedAt = client.client_id_issued_at
          ? format.dateTime(new Date(client.client_id_issued_at * 1000), {
              dateStyle: "medium",
            })
          : null;

        return (
          <div
            key={client.client_id}
            className="flex items-start justify-between gap-4 rounded-lg border p-4"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-semibold">{name}</p>
                {client.disabled ? (
                  <span className="bg-semantic-destructive/10 text-semantic-destructive inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                    {t("Status.disabled")}
                  </span>
                ) : null}
              </div>
              <p className="text-muted-foreground font-mono text-xs break-all">
                {client.client_id}
              </p>
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
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onEditClick(client)}
                title={t("Actions.editTooltip")}
                aria-label={t("Actions.editTooltip")}
              >
                <Pencil className="size-4" />
              </Button>
              {!client.public ? (
                <Button
                  size="sm"
                  variant="ghost"
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
