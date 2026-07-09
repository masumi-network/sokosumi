"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { VendorGrant } from "@/lib/clients/generated/core";

export function VendorAccessSection() {
  const t = useTranslations("App.Connections.VendorAccess");
  const [grants, setGrants] = useState<VendorGrant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingGrantId, setPendingGrantId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await coreClient.listMyVendorAccess();
      setGrants(response.data ?? []);
    } catch {
      toast.error(t("loadError"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runAction(
    grantId: string,
    action: "approve" | "deny" | "revoke",
  ) {
    setPendingGrantId(grantId);
    try {
      if (action === "approve") {
        await coreClient.approveMyVendorAccess(grantId);
      } else if (action === "deny") {
        await coreClient.denyMyVendorAccess(grantId);
      } else {
        await coreClient.revokeMyVendorAccess(grantId);
      }
      await refresh();
    } catch {
      toast.error(t("actionError"));
    } finally {
      setPendingGrantId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">{t("loading")}</p>
        ) : grants.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          grants.map((grant) => (
            <div
              key={grant.id}
              className="border-border flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium">{grant.vendor.name}</p>
                <p className="text-muted-foreground text-xs">
                  {grant.workspace.organization?.name ?? t("personalWorkspace")}
                  {" · "}
                  {t(`status.${grant.status}`)}
                  {" · "}
                  {t("scope", { scope: grant.scope })}
                </p>
                {grant.awaitingVendorApprovalTaskCount > 0 ? (
                  <p className="text-amber-700 dark:text-amber-300 text-xs font-medium">
                    {t("awaitingVendorApprovalTaskCount", {
                      count: grant.awaitingVendorApprovalTaskCount,
                    })}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {grant.status === "PENDING" ? (
                  <>
                    <Button
                      size="sm"
                      disabled={pendingGrantId === grant.id}
                      onClick={() => void runAction(grant.id, "approve")}
                    >
                      {t("approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingGrantId === grant.id}
                      onClick={() => void runAction(grant.id, "deny")}
                    >
                      {t("deny")}
                    </Button>
                  </>
                ) : null}
                {grant.status === "GRANTED" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pendingGrantId === grant.id}
                    onClick={() => void runAction(grant.id, "revoke")}
                  >
                    {t("revoke")}
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
