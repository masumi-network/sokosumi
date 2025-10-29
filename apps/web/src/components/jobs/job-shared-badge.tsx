"use client";

import { useTranslations } from "next-intl";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface JobSharedBadgeProps {
  creatorName: string;
  creatorImage?: string | null;
  className?: string;
}

export function JobSharedBadge({
  creatorName,
  creatorImage,
  className,
}: JobSharedBadgeProps) {
  const t = useTranslations("Components.Jobs.SharedBadge");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("flex items-center gap-1", className)}>
            <Avatar className="h-6 w-6">
              <AvatarImage src={creatorImage ?? undefined} />
              <AvatarFallback className="text-xs">
                {creatorName?.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <Badge
              variant="default"
              className={cn("bg-orange-100 text-orange-800", className)}
            >
              {t("shared")}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {t("sharedBy")} {creatorName}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
