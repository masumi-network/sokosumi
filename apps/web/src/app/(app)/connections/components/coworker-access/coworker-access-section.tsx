"use client";

import { Check, Loader2, ShieldQuestion, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  type CoworkerGrant,
  listCoworkerGrantsAction,
  resolveCoworkerGrantAction,
} from "@/lib/actions/coworker-grant/action";
import { cn } from "@/lib/utils";

type GrantScope = CoworkerGrant["scope"];
type GrantStatus = CoworkerGrant["status"];

const SCOPE_KEYS: Record<GrantScope, string> = {
  TASK_READ: "scopes.taskRead",
  TASK_COMMENT: "scopes.taskComment",
  TASK_CREATE: "scopes.taskCreate",
};

const STATUS_STYLES: Record<GrantStatus, string> = {
  PENDING:
    "border-semantic-warning/30 bg-semantic-warning/10 text-semantic-warning",
  GRANTED:
    "border-semantic-success/30 bg-semantic-success/10 text-semantic-success",
  DENIED: "border-border bg-muted/40 text-muted-foreground",
  REVOKED: "border-border bg-muted/40 text-muted-foreground",
};

/**
 * The "Coworker access" portal: per-coworker consent records behind
 * coworker API-key delegation. Pending requests carry approve/deny;
 * resolved grants can be flipped any time (revoke / re-approve).
 */
export function CoworkerAccessSection() {
  const t = useTranslations("App.Connections.CoworkerAccess");
  const [grants, setGrants] = useState<CoworkerGrant[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listCoworkerGrantsAction();
      if (cancelled) return;
      if (result.ok) {
        setGrants(result.data);
      } else {
        setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolve = useCallback(
    async (grantId: string, status: "GRANTED" | "DENIED" | "REVOKED") => {
      setBusyId(grantId);
      const result = await resolveCoworkerGrantAction(grantId, status);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error.message ?? t("resolveFailed"));
        return;
      }
      setGrants((prev) =>
        (prev ?? []).map((g) => (g.id === grantId ? result.data : g)),
      );
      toast.success(
        status === "GRANTED" ? t("approvedToast") : t("updatedToast"),
      );
    },
    [t],
  );

  if (loadFailed) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {t("loadError")}
      </p>
    );
  }

  if (grants === null) {
    return (
      <div className="flex justify-center py-10">
        <Loader2
          className="text-muted-foreground size-5 animate-spin"
          aria-hidden
        />
      </div>
    );
  }

  const pending = grants.filter((g) => g.status === "PENDING");
  const resolved = grants.filter((g) => g.status !== "PENDING");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-foreground text-base font-semibold">
          {t("heading")}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          {t("description")}
        </p>
      </div>

      {grants.length === 0 ? (
        <div className="border-border/50 bg-muted/30 flex flex-col items-center gap-2 rounded-xl border px-6 py-10 text-center">
          <ShieldQuestion
            className="text-muted-foreground size-6"
            aria-hidden
          />
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        </div>
      ) : (
        <>
          {pending.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                {t("pendingHeading")}
              </h3>
              <ul className="flex flex-col gap-2">
                {pending.map((grant) => (
                  <GrantRow
                    key={grant.id}
                    grant={grant}
                    busy={busyId === grant.id}
                    onResolve={resolve}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {resolved.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                {t("resolvedHeading")}
              </h3>
              <ul className="flex flex-col gap-2">
                {resolved.map((grant) => (
                  <GrantRow
                    key={grant.id}
                    grant={grant}
                    busy={busyId === grant.id}
                    onResolve={resolve}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function GrantRow({
  grant,
  busy,
  onResolve,
}: {
  grant: CoworkerGrant;
  busy: boolean;
  onResolve: (
    grantId: string,
    status: "GRANTED" | "DENIED" | "REVOKED",
  ) => Promise<void>;
}) {
  const t = useTranslations("App.Connections.CoworkerAccess");

  return (
    <li className="border-border/50 bg-muted/30 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
      <Avatar className="size-8">
        {grant.coworker.image ? (
          <AvatarImage src={grant.coworker.image} alt="" />
        ) : null}
        <AvatarFallback>
          {grant.coworker.name.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="text-foreground text-sm font-medium">
          {grant.coworker.name}
        </div>
        <div className="text-muted-foreground text-xs">
          {t(SCOPE_KEYS[grant.scope])}
        </div>
      </div>
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
          STATUS_STYLES[grant.status],
        )}
      >
        {t(`status.${grant.status}`)}
      </span>
      <div className="flex items-center gap-1.5">
        {busy ? (
          <Loader2
            className="text-muted-foreground size-4 animate-spin"
            aria-hidden
          />
        ) : grant.status === "PENDING" ? (
          <>
            <Button
              size="sm"
              variant="primary"
              className="gap-1.5"
              onClick={() => void onResolve(grant.id, "GRANTED")}
            >
              <Check className="size-3.5" aria-hidden />
              <span>{t("approve")}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void onResolve(grant.id, "DENIED")}
            >
              <X className="size-3.5" aria-hidden />
              <span>{t("deny")}</span>
            </Button>
          </>
        ) : grant.status === "GRANTED" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onResolve(grant.id, "REVOKED")}
          >
            {t("revoke")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onResolve(grant.id, "GRANTED")}
          >
            {t("approve")}
          </Button>
        )}
      </div>
    </li>
  );
}
