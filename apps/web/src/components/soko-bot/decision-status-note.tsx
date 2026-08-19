import { getTranslations } from "next-intl/server";

import type { SokoBotPendingDecision } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<SokoBotPendingDecision["status"], string> = {
  PENDING: "text-muted-foreground",
  PROCESSING: "text-semantic-warning",
  ACCEPTED: "text-semantic-success",
  REJECTED: "text-muted-foreground",
  EXPIRED: "text-muted-foreground",
};

interface DecisionStatusNoteProps {
  status: SokoBotPendingDecision["status"];
  resultingEntityId: string | null;
  className?: string;
}

/**
 * Plain-language explanation of what a decision status means, especially the
 * uncertain PROCESSING state (seller-side start in flight or unconfirmed).
 * Never invites an unsafe retry — Core owns retry/reject eligibility.
 */
export async function DecisionStatusNote({
  status,
  resultingEntityId,
  className,
}: DecisionStatusNoteProps) {
  const t = await getTranslations("Components.SokoBot.DecisionExplain");
  if (status === "PENDING") return null;
  return (
    <p
      role={status === "PROCESSING" ? "status" : undefined}
      className={cn("text-xs", TONE_CLASS[status], className)}
    >
      {t(status)}
      {status === "ACCEPTED" && resultingEntityId ? (
        <span className="text-muted-foreground font-mono">
          {" "}
          {resultingEntityId}
        </span>
      ) : null}
    </p>
  );
}
