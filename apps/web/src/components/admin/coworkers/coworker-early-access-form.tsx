"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
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
import { grantAdminCoworkerEarlyAccessAction } from "@/lib/actions/admin-coworkers/action";

interface CoworkerEarlyAccessFormProps {
  coworkerId: string;
  disabled?: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function CoworkerEarlyAccessForm({
  coworkerId,
  disabled = false,
}: CoworkerEarlyAccessFormProps) {
  const t = useTranslations("App.Admin.Coworkers.Form.EarlyAccess");
  const [workspaceId, setWorkspaceId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || isSubmitting) {
      return;
    }

    const trimmed = workspaceId.trim();
    if (!UUID_PATTERN.test(trimmed)) {
      toast.error(t("error"));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await grantAdminCoworkerEarlyAccessAction({
        coworkerId,
        workspaceId: trimmed,
      });

      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }

      setWorkspaceId("");
      toast.success(t("success"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card id="coworker-early-access">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="early-access-workspace-id">
              {t("workspaceIdLabel")}
            </Label>
            <Input
              id="early-access-workspace-id"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              placeholder={t("workspaceIdPlaceholder")}
              disabled={disabled || isSubmitting}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" disabled={disabled || isSubmitting}>
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
