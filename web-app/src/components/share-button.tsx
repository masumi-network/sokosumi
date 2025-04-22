"use client";

import { Share } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ShareButtonProps {
  className?: string;
}

export function ShareButton({ className }: ShareButtonProps) {
  const t = useTranslations("Components.ShareButton");

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
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
    >
      <Share />
    </Button>
  );
}
