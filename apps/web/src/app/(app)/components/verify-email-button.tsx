"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentProps, useState } from "react";

import { sendAccountVerificationEmail } from "@/app/components/account-notice-action";
import { Button } from "@/components/ui/button";
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
      await sendAccountVerificationEmail(email, {
        sendError: t("sendError"),
        sendSuccess: t("sendSuccess"),
      });
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
