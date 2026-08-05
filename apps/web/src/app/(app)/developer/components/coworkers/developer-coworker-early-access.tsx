"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { grantDeveloperCoworkerEarlyAccessAction } from "@/lib/actions/coworkers/workspace-access.action";
import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";

interface DeveloperCoworkerEarlyAccessProps {
  coworkerId: string;
  accessRows: CoworkerWorkspaceAccess[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function DeveloperCoworkerEarlyAccess({
  coworkerId,
  accessRows,
}: DeveloperCoworkerEarlyAccessProps) {
  const t = useTranslations("App.Developer.Coworkers.EarlyAccess");
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const trimmed = workspaceId.trim();
    if (!UUID_PATTERN.test(trimmed)) {
      toast.error(t("error"));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await grantDeveloperCoworkerEarlyAccessAction({
        coworkerId,
        workspaceId: trimmed,
      });

      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }

      setWorkspaceId("");
      toast.success(
        result.data.status === "PENDING" ? t("pendingSuccess") : t("success"),
      );
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  function statusLabel(status: CoworkerWorkspaceAccess["status"]): string {
    switch (status) {
      case "PENDING":
        return t("statusPending");
      case "GRANTED":
        return t("statusGranted");
      case "DENIED":
        return t("statusDenied");
      case "REVOKED":
        return t("statusRevoked");
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
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
                <li
                  key={row.id}
                  className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-mono text-xs">{row.workspaceId}</span>
                  <Badge
                    variant="secondary"
                    className="h-5 w-fit px-1.5 text-xs"
                  >
                    {statusLabel(row.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="developer-early-access-workspace-id">
              {t("workspaceIdLabel")}
            </Label>
            <Input
              id="developer-early-access-workspace-id"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              placeholder={t("workspaceIdPlaceholder")}
              disabled={isSubmitting}
              autoComplete="off"
              spellCheck={false}
            />
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
