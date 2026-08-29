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
import { signOutWithPushRelease } from "@/lib/auth/sign-out.client";

/**
 * Who is signing out. The id rides in beside the email rather than coming
 * from `useSession()`: this modal mounts from the root layout on every route,
 * so subscribing here would fetch the session on `/signin` and `/signup` too.
 */
export interface LogoutModalUser {
  id: string;
  email: string;
}

interface LogoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: LogoutModalUser | null;
}

export default function LogoutModal({
  open,
  onOpenChange,
  user,
}: LogoutModalProps) {
  const t = useTranslations("Components.Modals.LogoutModal");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    setLoading(true);
    await signOutWithPushRelease(user?.id, {
      fetchOptions: {
        onError: () => {
          toast.error(t("error"));
        },
        onSuccess: () => {
          const returnUrl =
            window.location.pathname + window.location.search || "/";
          router.push(`/signin?returnUrl=${encodeURIComponent(returnUrl)}`);
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
            {t("description", { email: user?.email ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="block space-y-1.5">
          <DialogClose asChild>
            <Button
              variant="primary"
              className="w-full"
              onClick={handleLogout}
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("logout")}
            </Button>
          </DialogClose>
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
