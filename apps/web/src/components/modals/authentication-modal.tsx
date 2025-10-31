import Link from "next/link";
import { useTranslations } from "next-intl";

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
          <DialogClose asChild>
            <Button variant="primary" className="w-full" asChild>
              <Link href="/signin">{t("login")}</Link>
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="secondary" className="w-full" asChild>
              <Link href="/signup">{t("register")}</Link>
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
