"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { stopImpersonationAction } from "@/lib/actions/admin-impersonation/action";
import { cn } from "@/lib/utils";

interface ImpersonationBannerExitProps {
  label: string;
  errorMessage: string;
  className?: string;
}

/** Exit control for the impersonation banner. Restores the admin session. */
export function ImpersonationBannerExit({
  label,
  errorMessage,
  className,
}: ImpersonationBannerExitProps) {
  const [isExiting, setIsExiting] = useState(false);

  async function handleExit() {
    setIsExiting(true);
    try {
      const result = await stopImpersonationAction({});
      if (!result.ok) {
        toast.error(result.error.message ?? errorMessage);
        return;
      }
      // Full reload: the session switched back under every client cache.
      window.location.reload();
    } finally {
      setIsExiting(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleExit}
      disabled={isExiting}
      className={cn("shrink-0", className)}
    >
      {label}
    </Button>
  );
}
