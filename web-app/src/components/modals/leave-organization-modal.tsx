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
import { leaveOrganization, LeaveOrganizationErrorCodes } from "@/lib/actions";
import { Organization } from "@/prisma/generated/client";

interface LeaveOrganizationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: Organization;
}

export default function LeaveOrganizationModal({
  open,
  onOpenChange,
  organization,
}: LeaveOrganizationModalProps) {
  const t = useTranslations("Components.Modals.LeaveOrganizationModal");
  const [loading, setLoading] = useState(false);

  const handleLeaveOrganization = async () => {
    setLoading(true);
    const result = await leaveOrganization(organization.id);
    if (!result.success) {
      switch (result.error.code) {
        case LeaveOrganizationErrorCodes.NOT_AUTHENTICATED:
          toast.error(t("Errors.unauthorized"));
          break;
        case LeaveOrganizationErrorCodes.MEMBER_COUNT_NOT_ALLOWED:
          toast.error(t("Errors.memberCountNotAllowed"));
          break;
        default:
          toast.error(t("error"));
          break;
      }
    } else {
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
            <Button variant="secondary" className="w-full">
              {t("cancel")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
