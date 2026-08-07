"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
  AsyncSearchCombobox,
  buildComboboxLabels,
} from "@/components/admin/async-search-combobox";
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
import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";
import type { AdminUserOption } from "@/lib/services/admin-user.service";

interface CoworkerEarlyAccessFormProps {
  coworkerId: string;
  disabled?: boolean;
}

type EarlyAccessTargetType = "organization" | "user";

export function CoworkerEarlyAccessForm({
  coworkerId,
  disabled = false,
}: CoworkerEarlyAccessFormProps) {
  const t = useTranslations("App.Admin.Coworkers.Form.EarlyAccess");
  const tOrg = useTranslations("Components.OrganizationCombobox");
  const tUser = useTranslations("Components.UserCombobox");
  const [targetType, setTargetType] =
    useState<EarlyAccessTargetType>("organization");
  const [selectedOrg, setSelectedOrg] =
    useState<AdminOrganizationOption | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserOption | null>(
    null,
  );
  const [isGranting, setIsGranting] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  const orgLabels = buildComboboxLabels(tOrg);
  const userLabels = buildComboboxLabels(tUser);

  async function runAction(mode: "grant" | "revoke") {
    if (disabled || isGranting || isRevoking) {
      return;
    }

    const targetId = targetType === "user" ? selectedUser?.id : selectedOrg?.id;
    if (!targetId) {
      toast.error(t("targetRequired"));
      return;
    }

    if (mode === "grant") {
      setIsGranting(true);
    } else {
      setIsRevoking(true);
    }

    try {
      const payload = {
        coworkerId,
        targetType,
        targetId,
      };
      const result =
        mode === "grant"
          ? await grantAdminCoworkerEarlyAccessAction(payload)
          : await revokeAdminCoworkerEarlyAccessAction(payload);

      if (!result.ok) {
        toast.error(
          result.error.message ??
            (mode === "grant" ? t("error") : t("revokeError")),
        );
        return;
      }

      setSelectedOrg(null);
      setSelectedUser(null);
      toast.success(mode === "grant" ? t("success") : t("revokeSuccess"));
    } finally {
      setIsGranting(false);
      setIsRevoking(false);
    }
  }

  const busy = isGranting || isRevoking;

  return (
    <Card id="coworker-early-access">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void runAction("grant");
          }}
        >
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
                <TabsTrigger value="organization" disabled={disabled || busy}>
                  {t("tabs.organization")}
                </TabsTrigger>
                <TabsTrigger value="user" disabled={disabled || busy}>
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
                disabled={disabled || busy}
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
                disabled={disabled || busy}
              />
            )}
            <p className="text-muted-foreground text-xs">{t("targetHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={disabled || busy}>
              {isGranting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t("submit")}
                </>
              ) : (
                t("submit")
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || busy}
              onClick={() => {
                void runAction("revoke");
              }}
            >
              {isRevoking ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t("revoke")}
                </>
              ) : (
                t("revoke")
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
