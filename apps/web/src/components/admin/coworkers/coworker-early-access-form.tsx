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
import {
  grantAdminCoworkerEarlyAccessAction,
  revokeAdminCoworkerEarlyAccessAction,
} from "@/lib/actions/admin-coworkers/action";

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
  const [isGranting, setIsGranting] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  async function runAction(mode: "grant" | "revoke") {
    if (disabled || isGranting || isRevoking) {
      return;
    }

    const trimmed = workspaceId.trim();
    if (!UUID_PATTERN.test(trimmed)) {
      toast.error(t("error"));
      return;
    }

    if (mode === "grant") {
      setIsGranting(true);
    } else {
      setIsRevoking(true);
    }

    try {
      const result =
        mode === "grant"
          ? await grantAdminCoworkerEarlyAccessAction({
              coworkerId,
              workspaceId: trimmed,
            })
          : await revokeAdminCoworkerEarlyAccessAction({
              coworkerId,
              workspaceId: trimmed,
            });

      if (!result.ok) {
        toast.error(
          result.error.message ??
            (mode === "grant" ? t("error") : t("revokeError")),
        );
        return;
      }

      setWorkspaceId("");
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
            <Label htmlFor="early-access-workspace-id">
              {t("workspaceIdLabel")}
            </Label>
            <Input
              id="early-access-workspace-id"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              placeholder={t("workspaceIdPlaceholder")}
              disabled={disabled || busy}
              autoComplete="off"
              spellCheck={false}
            />
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
