"use client";

import { Share } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { URL } from "url";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ShareButtonProps {
  url: URL;
  className?: string;
  disabled?: boolean;
}

export function ShareButton({ url, className, disabled }: ShareButtonProps) {
  const t = useTranslations("Components.ShareButton");

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success(t("linkCopied"));
    } catch {
      toast.error(t("copyError"));
    }
  };

  return (
    <Button
      variant="secondary"
      size="icon"
      onClick={handleShare}
      className={cn(className)}
      disabled={disabled}
    >
      <Share />
    </Button>
  );
}
