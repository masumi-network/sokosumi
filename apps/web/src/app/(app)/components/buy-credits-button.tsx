"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface BuyCreditsButtonProps {
  label: string;
  path: string;
  className?: string;
  disabled?: boolean;
  iconRight?: ReactNode;
}

export default function BuyCreditsButton({
  label,
  path,
  className,
  disabled,
  iconRight,
}: BuyCreditsButtonProps) {
  const router = useRouter();
  const { isMobile, toggleSidebar } = useSidebar();

  function handleClick(): void {
    router.push(path);
    if (isMobile) {
      toggleSidebar();
    }
  }

  return (
    <Button
      type="button"
      variant="default"
      size="sm"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5",
        className,
      )}
      disabled={disabled}
    >
      {label}
      {iconRight}
    </Button>
  );
}
