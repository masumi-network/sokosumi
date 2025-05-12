import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AuthenticationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AuthenticationModal({
  open,
  onOpenChange,
}: AuthenticationModalProps) {
  const t = useTranslations("Components.Modals.AuthenticationModal");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-sm">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-medium">
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-center text-base">
            {t("description")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="block space-y-1.5">
          <Button variant="primary" className="w-full" asChild>
            <Link href="/login">{t("login")}</Link>
          </Button>
          <Button variant="secondary" className="w-full" asChild>
            <Link href="/register">{t("register")}</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
