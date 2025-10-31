"use client";

import type { AgentRatingStats } from "@sokosumi/database";
import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { AgentRatingForm } from "@/components/agents/agent-rating-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface AgentRatingCTAProps {
  agentId: string;
  ratingStats?: AgentRatingStats;
  existingRating?: {
    rating: number;
    comment: string | null;
  } | null;
  className?: string;
  disabled?: boolean;
}

export function AgentRatingCTA({
  agentId,
  ratingStats: _ratingStats,
  existingRating,
  className,
  disabled,
}: AgentRatingCTAProps) {
  const router = useRouter();
  const t = useTranslations("Components.Agents.Rating");
  const [isOpen, setIsOpen] = useState(false);

  const handleSuccess = () => {
    setIsOpen(false);
    toast.success(t("successMessage"));
    router.refresh();
  };

  return (
    <div className={className}>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            className={className}
            disabled={disabled}
          >
            <Star
              fill={existingRating ? "currentColor" : "none"}
              className="size-4"
            />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {existingRating ? t("updateRating") : t("submitRating")}
            </DialogTitle>
          </DialogHeader>
          <AgentRatingForm
            agentId={agentId}
            existingRating={existingRating?.rating ?? null}
            existingComment={existingRating?.comment ?? null}
            onSuccess={handleSuccess}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
