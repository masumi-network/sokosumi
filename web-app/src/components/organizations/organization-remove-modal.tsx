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
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { authClient } from "@/lib/auth/auth.client";
import { Organization } from "@/prisma/generated/client";

interface OrganizationRemoveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: Organization;
}

export function OrganizationRemoveModal({
  open,
  onOpenChange,
  organization,
}: OrganizationRemoveModalProps) {
  const t = useTranslations("Components.Organizations.RemoveModal");
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);

  const handleOpenChange = (open: boolean) => {
    if (isLoading) {
      return;
    }
    onOpenChange(open);
  };

  const handleRemove = async () => {
    setIsLoading(true);
    const result = await authClient.organization.delete({
      organizationId: organization.id,
    });
    if (result.error) {
      const errorMessage = result.error.message ?? t("error");
      if (result.error.status === 401) {
        toast.error(errorMessage, {
          action: {
            label: t("Errors.unauthorizedAction"),
            onClick: async () => {
              router.push("/login");
            },
          },
        });
      } else {
        toast.error(errorMessage);
      }
    } else {
      toast.success(t("success"));
      router.push("/organizations");
    }
    setIsLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-lg" />
        <DialogContent className="w-md">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-medium">
              {t("title")}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-center text-base">
              {t("description", { organization: organization.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex items-center gap-1.5">
            <Button
              variant="destructive"
              onClick={handleRemove}
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading && <Loader2 className="animate-spin" />}
              {t("confirm")}
            </Button>
            <DialogClose asChild>
              <Button
                variant="secondary"
                disabled={isLoading}
                className="flex-1"
              >
                {t("cancel")}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
