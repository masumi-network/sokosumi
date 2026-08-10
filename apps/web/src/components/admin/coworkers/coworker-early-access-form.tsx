"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
  AsyncSearchCombobox,
  buildComboboxLabels,
} from "@/components/admin/async-search-combobox";
import { WorkspaceAccessRow } from "@/components/coworker-access/workspace-access-row";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  grantAdminCoworkerEarlyAccessAction,
  revokeAdminCoworkerEarlyAccessAction,
} from "@/lib/actions/admin-coworkers/action";
import {
  searchOrganizationsClient,
  searchUsersClient,
} from "@/lib/actions/admin-search/client";
import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";
import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";
import type { AdminUserOption } from "@/lib/services/admin-user.service";

interface CoworkerEarlyAccessFormProps {
  coworkerId: string;
  accessRows?: CoworkerWorkspaceAccess[];
  disabled?: boolean;
}

type EarlyAccessTargetType = "organization" | "user";

export function CoworkerEarlyAccessForm({
  coworkerId,
  accessRows = [],
  disabled = false,
}: CoworkerEarlyAccessFormProps) {
  const t = useTranslations("App.Admin.Coworkers.Form.EarlyAccess");
  const tOrg = useTranslations("Components.OrganizationCombobox");
  const tUser = useTranslations("Components.UserCombobox");
  const router = useRouter();
  const [targetType, setTargetType] =
    useState<EarlyAccessTargetType>("organization");
  const [selectedOrg, setSelectedOrg] =
    useState<AdminOrganizationOption | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserOption | null>(
    null,
  );
  const [isGranting, setIsGranting] = useState(false);

  const orgLabels = buildComboboxLabels(tOrg);
  const userLabels = buildComboboxLabels(tUser);

  async function handleGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || isGranting) {
      return;
    }

    const targetId = targetType === "user" ? selectedUser?.id : selectedOrg?.id;
    if (!targetId) {
      toast.error(t("targetRequired"));
      return;
    }

    setIsGranting(true);
    try {
      const result = await grantAdminCoworkerEarlyAccessAction({
        coworkerId,
        targetType,
        targetId,
      });

      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }

      setSelectedOrg(null);
      setSelectedUser(null);
      toast.success(t("success"));
      router.refresh();
    } finally {
      setIsGranting(false);
    }
  }

  async function handleRevokeRow(row: CoworkerWorkspaceAccess) {
    const result = await revokeAdminCoworkerEarlyAccessAction({
      coworkerId,
      workspaceId: row.workspaceId,
    });
    if (!result.ok) {
      toast.error(result.error.message ?? t("revokeError"));
      throw new Error(result.error.message ?? "revoke failed");
    }
    toast.success(t("revokeSuccess"));
    router.refresh();
  }

  return (
    <Card id="coworker-early-access">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t("listTitle")}</h3>
          {accessRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("listEmpty")}</p>
          ) : (
            <ul className="divide-border divide-y rounded-lg border">
              {accessRows.map((row) => (
                <WorkspaceAccessRow
                  key={row.id}
                  row={row}
                  statusNamespace="App.Admin.Coworkers.Form.EarlyAccess"
                  onRevoke={disabled ? undefined : handleRevokeRow}
                />
              ))}
            </ul>
          )}
        </section>

        <form className="space-y-4" onSubmit={handleGrant}>
          <div className="space-y-2">
            <Label htmlFor="early-access-target">{t("targetLabel")}</Label>
            <Tabs
              value={targetType}
              onValueChange={(value) => {
                setTargetType(value as EarlyAccessTargetType);
                setSelectedOrg(null);
                setSelectedUser(null);
              }}
            >
              <TabsList>
                <TabsTrigger
                  value="organization"
                  disabled={disabled || isGranting}
                >
                  {t("tabs.organization")}
                </TabsTrigger>
                <TabsTrigger value="user" disabled={disabled || isGranting}>
                  {t("tabs.user")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {targetType === "organization" ? (
              <AsyncSearchCombobox<AdminOrganizationOption>
                id="early-access-target"
                value={selectedOrg}
                onChange={setSelectedOrg}
                search={searchOrganizationsClient}
                getKey={(org) => org.id}
                getTriggerLabel={(org) => org.name}
                renderOption={(org) => (
                  <span className="flex flex-col">
                    <span>{org.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {org.slug}
                    </span>
                  </span>
                )}
                labels={orgLabels}
                disabled={disabled || isGranting}
              />
            ) : (
              <AsyncSearchCombobox<AdminUserOption>
                id="early-access-target"
                value={selectedUser}
                onChange={setSelectedUser}
                search={searchUsersClient}
                getKey={(user) => user.id}
                getTriggerLabel={(user) => user.name}
                renderOption={(user) => (
                  <span className="flex flex-col">
                    <span>{user.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {user.email}
                    </span>
                  </span>
                )}
                labels={userLabels}
                disabled={disabled || isGranting}
              />
            )}
            <p className="text-muted-foreground text-xs">{t("targetHint")}</p>
          </div>
          <Button type="submit" disabled={disabled || isGranting}>
            {isGranting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t("submit")}
              </>
            ) : (
              t("submit")
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
