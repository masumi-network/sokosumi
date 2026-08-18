"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WorkspaceGateErrorCode } from "@/lib/actions/errors";
import { deletePersonalWorkspaceAction } from "@/lib/actions/workspace-gate";
import { activateOrganizationWorkspace } from "@/lib/activate-organization-workspace";

interface DeletePersonalWorkspaceFormProps {
  hasOrganizationMembership: boolean;
  fallbackOrganizationId: string | null;
  currentOrganizationId: string | null;
}

export function DeletePersonalWorkspaceForm({
  hasOrganizationMembership,
  fallbackOrganizationId,
  currentOrganizationId,
}: DeletePersonalWorkspaceFormProps) {
  const t = useTranslations("App.Account.DeletePersonal");
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      const result = await deletePersonalWorkspaceAction({});
      if (!result.ok) {
        if (result.error.code === WorkspaceGateErrorCode.LAST_WORKSPACE) {
          toast.error(t("lastWorkspaceError"));
          return;
        }
        if (
          result.error.code === WorkspaceGateErrorCode.WORKSPACE_HAS_DEPENDENTS
        ) {
          toast.error(t("dependentsError"));
          return;
        }
        toast.error(t("error"));
        return;
      }

      if (currentOrganizationId === null && fallbackOrganizationId) {
        try {
          await activateOrganizationWorkspace(fallbackOrganizationId);
        } catch (error) {
          console.error(
            "Failed to activate remaining organization after personal delete",
            error,
          );
          try {
            await activateOrganizationWorkspace(fallbackOrganizationId);
          } catch (retryError) {
            console.error(
              "Failed to activate remaining organization after personal delete retry",
              retryError,
            );
            toast.error(t("activateError"));
            router.refresh();
            return;
          }
        }
      }

      toast.success(t("success"));
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle className="text-destructive">{t("title")}</CardTitle>
        <CardDescription>
          {hasOrganizationMembership
            ? t("description")
            : t("lastWorkspaceDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" disabled={!hasOrganizationMembership}>
              {t("button")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("confirmTitle")}</DialogTitle>
              <DialogDescription>{t("confirmDescription")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="destructive"
                disabled={isSubmitting || !hasOrganizationMembership}
                onClick={() => {
                  void handleDelete();
                }}
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                {t("confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
