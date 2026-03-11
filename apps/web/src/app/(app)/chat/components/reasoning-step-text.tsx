"use client";

import { useTypingReveal } from "@/app/chat/hooks/use-typing-reveal";
import { cn } from "@/lib/utils";

function formatReasoningStepText(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

interface ReasoningStepTextProps {
  text: string;
  className?: string;
  showCursor?: boolean;
}

export function ReasoningStepText({
  text,
  className,
  showCursor = false,
}: ReasoningStepTextProps) {
  const formatted = formatReasoningStepText(text);
  const displayContent = useTypingReveal(formatted);
  return (
    <span
      className={cn(showCursor && "reasoning-step-typing", className)}
      style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
    >
      {displayContent}
    </span>
  );
}
