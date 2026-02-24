"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { StarIcon } from "@/components/agents/star-icon";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createAgentRating } from "@/lib/actions/agent/create-agent-rating";
import { cn } from "@/lib/utils";

interface AgentRatingFormProps {
  agentId: string;
  existingRating?: number | null;
  existingComment?: string | null;
  onSuccess?: () => void;
  className?: string;
}

export function AgentRatingForm({
  agentId,
  existingRating = null,
  existingComment = null,
  onSuccess,
  className,
}: AgentRatingFormProps) {
  const t = useTranslations("Components.Agents.Rating");
  const [rating, setRating] = useState(existingRating ?? 0);
  const [comment, setComment] = useState(existingComment ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.error(t("selectRating"));
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createAgentRating(
        agentId,
        rating,
        comment || undefined,
      );

      if (result.ok) {
        toast.success(t("successMessage"));
        onSuccess?.();
      } else {
        toast.error(result.error.message);
      }
    } catch (error) {
      console.error("Error submitting rating:", error);
      toast.error(t("errorMessage"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const commentMaxLength = 1000;

  return (
    <div className={cn("space-y-4", className)}>
      <div>
        <label className="mb-2 block text-sm font-medium">
          {t("ratingLabel")}
        </label>
        <div className="flex items-center gap-1">
          {Array.from({ length: 5 }, (_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setRating(index + 1)}
              className="hover:bg-muted rounded transition-colors"
              disabled={isSubmitting}
            >
              <StarIcon
                fillPercentage={index < rating ? 100 : 0}
                size="lg"
                className="transition-colors"
              />
            </button>
          ))}
          <span className="text-muted-foreground ml-2 text-sm">
            {rating > 0 && `${rating}/5`}
          </span>
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          {t("commentLabel")}
        </label>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("commentPlaceholder")}
          className="min-h-[80px]"
          disabled={isSubmitting}
          maxLength={commentMaxLength}
        />
        {comment.length > 0 && (
          <p className="text-muted-foreground mt-1 text-right text-xs">
            {`${comment.length}/${commentMaxLength}`}
          </p>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || rating === 0}
          className="ml-auto size-7 rounded-full"
          size="icon"
          aria-label={t("submitButton")}
        >
          {isSubmitting ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <ArrowUp className="size-3.5" aria-hidden />
          )}
        </Button>
      </div>
    </div>
  );
}
