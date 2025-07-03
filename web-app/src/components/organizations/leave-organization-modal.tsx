"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAsyncRouter } from "@/hooks/use-async-router";
import { revalidateOrganizationsPath } from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";
import { Organization } from "@/prisma/generated/client";

interface LeaveOrganizationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: Organization;
}

export function LeaveOrganizationModal({
  open,
  onOpenChange,
  organization,
}: LeaveOrganizationModalProps) {
  const t = useTranslations("Components.Organizations.LeaveOrganizationModal");
  const [loading, setLoading] = useState(false);
  const router = useAsyncRouter();

  const handleLeaveOrganization = async () => {
    setLoading(true);
    try {
      // list organizations
      const organizationsResult = await authClient.organization.list();
      if (!organizationsResult.data) {
        toast.error(t("Errors.notAuthenticated"));
        await router.push("/login");
        return;
      }
      const organizations = organizationsResult.data;
      if (organizations.length < 2) {
        toast.error(t("Errors.organizationsCountNotAllowed"));
        return;
      }

      const result = await authClient.organization.leave({
        organizationId: organization.id,
      });
      if (result.error) {
        console.error("Error leaving organization", result.error);
        toast.error(t("error"));
        return;
      }

      await revalidateOrganizationsPath();
      toast.success(t("success"));
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={loading || open} onOpenChange={onOpenChange}>
      <DialogContent className="w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-medium">
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-center text-base">
            {t("description", {
              organization: organization.name,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="block space-y-1.5">
          <Button
            variant="primary"
            className="w-full"
            onClick={handleLeaveOrganization}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("leave")}
          </Button>
          <DialogClose asChild>
            <Button variant="secondary" className="w-full" disabled={loading}>
              {t("cancel")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
