"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ActionError } from "@/lib/actions/errors";
import type { Result } from "@/lib/ts-res";

interface VendorGrantApprovalActionsLabels {
  approve: string;
  deny?: string;
  review: string;
  approveSuccess: string;
  approveError: string;
  denySuccess?: string;
  denyError?: string;
}

interface VendorGrantApprovalActionsProps {
  canApprove: boolean;
  reviewHref?: string | null;
  refreshAfterApproveAttempt?: boolean;
  labels: VendorGrantApprovalActionsLabels;
  onApprove: () => Promise<Result<unknown, ActionError>>;
  onDeny?: () => Promise<Result<unknown, ActionError>>;
}

export function VendorGrantApprovalActions({
  canApprove,
  reviewHref,
  refreshAfterApproveAttempt = false,
  labels,
  onApprove,
  onDeny,
}: VendorGrantApprovalActionsProps) {
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<"approve" | "deny" | null>(
    null,
  );

  async function runAction(
    action: "approve" | "deny",
    mutation: () => Promise<Result<unknown, ActionError>>,
  ) {
    setLoadingAction(action);
    let shouldRefresh = false;
    try {
      const result = await mutation();
      if (!result.ok) {
        const errorMessage =
          action === "approve"
            ? labels.approveError
            : (labels.denyError ?? labels.approveError);
        toast.error(result.error?.message ?? errorMessage);
        shouldRefresh = action === "approve" && refreshAfterApproveAttempt;
        return;
      }

      const successMessage =
        action === "approve"
          ? labels.approveSuccess
          : (labels.denySuccess ?? labels.approveSuccess);
      toast.success(successMessage);
      shouldRefresh = true;
    } catch {
      toast.error(
        action === "approve"
          ? labels.approveError
          : (labels.denyError ?? labels.approveError),
      );
      shouldRefresh = action === "approve" && refreshAfterApproveAttempt;
    } finally {
      if (shouldRefresh) {
        router.refresh();
      }
      setLoadingAction(null);
    }
  }

  const showDeny = canApprove && onDeny != null && labels.deny != null;

  return (
    <div className="flex flex-wrap gap-2">
      {canApprove ? (
        <Button
          size="sm"
          disabled={loadingAction !== null}
          onClick={() => void runAction("approve", onApprove)}
        >
          {loadingAction === "approve" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {labels.approve}
        </Button>
      ) : null}
      {showDeny ? (
        <Button
          size="sm"
          variant="outline"
          disabled={loadingAction !== null}
          onClick={() => void runAction("deny", onDeny)}
        >
          {loadingAction === "deny" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {labels.deny}
        </Button>
      ) : null}
      {reviewHref ? (
        <Button size="sm" variant={canApprove ? "outline" : "default"} asChild>
          <Link href={reviewHref}>{labels.review}</Link>
        </Button>
      ) : null}
    </div>
  );
}
