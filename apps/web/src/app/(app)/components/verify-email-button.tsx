"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentProps, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";

export interface VerifyEmailButtonProps {
  email: string;
  label: string;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
}

export default function VerifyEmailButton({
  email,
  label,
  className,
  variant = "default",
  size = "sm",
}: VerifyEmailButtonProps) {
  const t = useTranslations("App.EmailVerificationNotice");
  const [isSending, setIsSending] = useState(false);

  const handleClick = async () => {
    if (isSending) {
      return;
    }

    setIsSending(true);

    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: window.location.href,
      });

      if (result.error) {
        toast.error(result.error.message ?? t("sendError"));
        return;
      }

      toast.success(t("sendSuccess"));
    } catch {
      toast.error(t("sendError"));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={() => {
        void handleClick();
      }}
      className={cn(
        "inline-flex items-center justify-center gap-1.5",
        className,
      )}
      disabled={isSending}
    >
      {isSending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : null}
      {label}
    </Button>
  );
}
