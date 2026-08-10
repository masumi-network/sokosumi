"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { WorkspaceAccessRow } from "@/components/coworker-access/workspace-access-row";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  grantDeveloperCoworkerEarlyAccessAction,
  revokeDeveloperCoworkerEarlyAccessAction,
} from "@/lib/actions/coworkers/workspace-access.action";
import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";

interface DeveloperCoworkerEarlyAccessProps {
  coworkerId: string;
  accessRows: CoworkerWorkspaceAccess[];
}

type EarlyAccessTargetType = "organization" | "user";

export function DeveloperCoworkerEarlyAccess({
  coworkerId,
  accessRows,
}: DeveloperCoworkerEarlyAccessProps) {
  const t = useTranslations("App.Developer.Coworkers.EarlyAccess");
  const router = useRouter();
  const [targetType, setTargetType] =
    useState<EarlyAccessTargetType>("organization");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const value =
      targetType === "organization" ? organizationSlug.trim() : email.trim();
    if (!value) {
      toast.error(t("targetRequired"));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await grantDeveloperCoworkerEarlyAccessAction({
        coworkerId,
        targetType,
        targetValue: value,
      });

      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }

      setOrganizationSlug("");
      setEmail("");
      toast.success(
        result.data.status === "PENDING" ? t("pendingSuccess") : t("success"),
      );
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevokeRow(row: CoworkerWorkspaceAccess) {
    const result = await revokeDeveloperCoworkerEarlyAccessAction({
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
                  statusNamespace="App.Developer.Coworkers.EarlyAccess"
                  onRevoke={handleRevokeRow}
                />
              ))}
            </ul>
          )}
        </section>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="developer-early-access-target">
              {t("targetLabel")}
            </Label>
            <Tabs
              value={targetType}
              onValueChange={(value) => {
                setTargetType(value as EarlyAccessTargetType);
                setOrganizationSlug("");
                setEmail("");
              }}
            >
              <TabsList>
                <TabsTrigger value="organization" disabled={isSubmitting}>
                  {t("tabs.organization")}
                </TabsTrigger>
                <TabsTrigger value="user" disabled={isSubmitting}>
                  {t("tabs.user")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {targetType === "organization" ? (
              <Input
                id="developer-early-access-target"
                value={organizationSlug}
                onChange={(event) => setOrganizationSlug(event.target.value)}
                placeholder={t("organizationSlugPlaceholder")}
                disabled={isSubmitting}
                autoComplete="off"
                spellCheck={false}
              />
            ) : (
              <Input
                id="developer-early-access-target"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("emailPlaceholder")}
                disabled={isSubmitting}
                autoComplete="off"
                spellCheck={false}
              />
            )}
            <p className="text-muted-foreground text-xs">{t("hint")}</p>
          </div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
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
