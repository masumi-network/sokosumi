"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface BuyCreditsButtonProps {
  label: string;
  path: string;
  className?: string;
  collapseWithSidebar?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}

export default function BuyCreditsButton({
  label,
  path,
  className,
  collapseWithSidebar = false,
  disabled,
  icon,
}: BuyCreditsButtonProps) {
  const router = useRouter();
  const { isMobile, state, toggleSidebar } = useSidebar();
  const isCollapsed = collapseWithSidebar && state === "collapsed";

  function handleClick(): void {
    router.push(path);
    if (isMobile) {
      toggleSidebar();
    }
  }

  const button = (
    <Button
      type="button"
      variant="default"
      size="sm"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5",
        isCollapsed ? "size-8 p-0" : "w-full",
        className,
      )}
      disabled={disabled}
      aria-label={isCollapsed ? label : undefined}
    >
      {icon}
      {isCollapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span>{label}</span>
      )}
    </Button>
  );

  if (!isCollapsed || isMobile) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" align="center">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
