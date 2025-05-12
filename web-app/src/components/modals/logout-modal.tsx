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
import { signOut } from "@/lib/auth/auth.client";

interface LogoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
}

export default function LogoutModal({
  open,
  onOpenChange,
  email,
}: LogoutModalProps) {
  const t = useTranslations("Components.Modals.LogoutModal");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    setLoading(true);
    await signOut({
      fetchOptions: {
        onError: () => {
          toast.error(t("error"));
        },
        onSuccess: () => {
          router.push("/login");
        },
      },
    });
    setLoading(false);
  };

  return (
    <Dialog open={loading || open} onOpenChange={onOpenChange}>
      <DialogContent className="w-sm">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-medium">
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-center text-base">
            {t("description", { email })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="block space-y-1.5">
          <Button
            variant="primary"
            className="w-full"
            onClick={handleLogout}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("logout")}
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
