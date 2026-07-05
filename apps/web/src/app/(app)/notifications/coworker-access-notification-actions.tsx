"use client";

import { Check, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { CoworkerGrant } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<CoworkerGrant["status"], string> = {
  PENDING:
    "border-semantic-warning/30 bg-semantic-warning/10 text-semantic-warning",
  GRANTED:
    "border-semantic-success/30 bg-semantic-success/10 text-semantic-success",
  DENIED: "border-border bg-muted/40 text-muted-foreground",
  REVOKED: "border-border bg-muted/40 text-muted-foreground",
};

/**
 * Inline resolution controls for a COWORKER_ACCESS notification row:
 * approve/deny while the grant request is pending, a status chip once
 * decided (the portal under Connections → Coworker access can always
 * change it later). `grant` is null while the lookup is loading or when
 * the grant row no longer exists.
 */
export function CoworkerAccessNotificationActions({
  grant,
  busy,
  onResolve,
}: {
  grant: CoworkerGrant | null;
  busy: boolean;
  onResolve: (status: "GRANTED" | "DENIED") => void;
}) {
  const t = useTranslations("App.Connections.CoworkerAccess");

  if (!grant) return null;

  if (busy) {
    return (
      <div className="pl-9">
        <Loader2
          className="text-muted-foreground size-4 animate-spin"
          aria-hidden
        />
      </div>
    );
  }

  if (grant.status === "PENDING") {
    // stopPropagation: inside the header dropdown the row itself navigates
    // (and Radix closes the menu on item select) — deciding must do neither.
    return (
      <div className="flex items-center gap-1.5 pl-9">
        <Button
          size="sm"
          variant="primary"
          className="gap-1.5"
          onClick={(event) => {
            event.stopPropagation();
            onResolve("GRANTED");
          }}
        >
          <Check className="size-3.5" aria-hidden />
          <span>{t("approve")}</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={(event) => {
            event.stopPropagation();
            onResolve("DENIED");
          }}
        >
          <X className="size-3.5" aria-hidden />
          <span>{t("deny")}</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="pl-9">
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
          STATUS_STYLES[grant.status],
        )}
      >
        {t(`status.${grant.status}`)}
      </span>
    </div>
  );
}
