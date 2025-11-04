"use client";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

interface BuyCreditsButtonProps {
  label?: string;
  path?: string;
  className?: string;
  disabled?: boolean;
}

export default function BuyCreditsButton({
  label = "Buy",
  path = "/credits",
  className,
  disabled,
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
      className={className}
      disabled={disabled}
    >
      {label}
    </Button>
  );
}
