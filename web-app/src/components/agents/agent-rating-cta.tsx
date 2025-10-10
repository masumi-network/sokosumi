"use client";

import { Star } from "lucide-react";
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
import { AgentRatingStats } from "@/lib/db/repositories/agentRating.repository";

interface AgentRatingCTAProps {
  agentId: string;
  ratingStats?: AgentRatingStats;
  existingRating?: {
    rating: number;
    comment: string | null;
  } | null;
  className?: string;
}

export function AgentRatingCTA({
  agentId,
  ratingStats: _ratingStats,
  existingRating,
  className,
}: AgentRatingCTAProps) {
  const t = useTranslations("Components.Agents.Rating");
  const [isOpen, setIsOpen] = useState(false);

  const handleSuccess = () => {
    setIsOpen(false);
    toast.success(t("successMessage"));
    // Refresh the page to update rating stats
    window.location.reload();
  };

  return (
    <div className={className}>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Star className="size-4" />
            {existingRating
              ? t("alreadyRated", { rating: existingRating.rating })
              : t("submitRating")}
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
