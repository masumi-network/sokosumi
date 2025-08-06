"use client";

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
import {
  CommonErrorCode,
  leaveOrganization,
  OrganizationErrorCode,
} from "@/lib/actions";
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
  const router = useRouter();

  const handleLeaveOrganization = async () => {
    setLoading(true);
    try {
      const result = await leaveOrganization(organization.id);
      if (result.ok) {
        router.refresh();
        toast.success(t("success"));
        onOpenChange(false);
      } else {
        switch (result.error.code) {
          case CommonErrorCode.UNAUTHENTICATED:
            toast.error(t("Errors.unauthenticated"), {
              action: {
                label: t("Errors.unauthenticatedAction"),
                onClick: () => {
                  router.push(`/login`);
                },
              },
            });
            break;
          case CommonErrorCode.UNAUTHORIZED:
            toast.error(t("Errors.unauthorized"));
            break;
          case OrganizationErrorCode.LAST_PERSON:
            toast.error(t("Errors.lastPerson"));
            break;
          case OrganizationErrorCode.LAST_ADMIN:
            toast.error(t("Errors.lastAdmin"));
            break;
          case CommonErrorCode.INTERNAL_SERVER_ERROR:
          default:
            toast.error(t("error"));
            break;
        }
      }
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
