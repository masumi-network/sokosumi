"use client";

import { Organization } from "@sokosumi/database";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { authClient } from "@/lib/auth/auth.client";

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
  const router = useRouter();

  const handleLeaveOrganization = async () => {
    setLoading(true);
    const result = await authClient.organization.leave({
      organizationId: organization.id,
    });
    if (result.error) {
      const errorMessage = result.error.message ?? t("error");
      if (result.error.status === 401) {
        toast.error(errorMessage, {
          action: {
            label: t("Errors.unauthorizedAction"),
            onClick: () => {
              router.push(`/login`);
            },
          },
        });
      } else {
        toast.error(errorMessage);
      }
    } else {
      router.refresh();
      toast.success(t("success"));
      onOpenChange(false);
    }
    setLoading(false);
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
