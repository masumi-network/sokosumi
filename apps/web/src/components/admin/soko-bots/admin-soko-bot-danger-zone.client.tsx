"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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
import { deleteAdminSokoBotAction } from "@/lib/actions/admin-soko-bots/action";
import { ADMIN_SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";

/**
 * Deleting another person's assistant is irreversible, so the operator has to
 * type the owner's email rather than click through a dialog. A shared bot has
 * no owner, so its id is what the operator types.
 */
export function AdminSokoBotDangerZone({
  sokoBotId,
  botName,
  ownerEmail,
}: {
  sokoBotId: string;
  botName: string | null;
  /** Null for a project or workspace bot. */
  ownerEmail: string | null;
}) {
  const t = useTranslations("App.Admin.SokoBots.Detail.danger");
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const expected = ownerEmail ?? sokoBotId;
  const armed = confirmation.trim().toLowerCase() === expected.toLowerCase();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteAdminSokoBotAction({ input: { sokoBotId } });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      toast.success(
        result.value.outcome === "deleted"
          ? t("deleted")
          : t("tombstoned", {
              tasks: result.value.retained.tasks,
              messages: result.value.retained.chatMessages,
            }),
      );
      router.push(ADMIN_SOKO_BOTS_ROUTE);
    });
  }

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-destructive text-base">
          {t("title")}
        </CardTitle>
        <CardDescription>
          {t("description", { name: botName ?? t("unnamedBot") })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="admin-delete-confirmation">
            {ownerEmail
              ? t("confirmLabel", { email: ownerEmail })
              : t("confirmLabelShared", { id: sokoBotId })}
          </Label>
          <Input
            id="admin-delete-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="max-w-sm"
          />
        </div>
        <Button
          variant="destructive"
          size="sm"
          loading={pending}
          disabled={!armed}
          onClick={handleDelete}
        >
          {t("delete")}
        </Button>
      </CardContent>
    </Card>
  );
}
