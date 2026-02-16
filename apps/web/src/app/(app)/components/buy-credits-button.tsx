"use client";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface BuyCreditsButtonProps {
  label?: string;
  path?: string;
  className?: string;
  disabled?: boolean;
  iconRight?: React.ReactNode;
}

export default function BuyCreditsButton({
  label = "Buy",
  path = "/credits",
  className,
  disabled,
  iconRight,
}: BuyCreditsButtonProps) {
  const router = useRouter();
  const { isMobile, toggleSidebar } = useSidebar();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!path) return;
    router.push(path);
    if (isMobile) {
      toggleSidebar();
    }
  };

  return (
    <Button
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
