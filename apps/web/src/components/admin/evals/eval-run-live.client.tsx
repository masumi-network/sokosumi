"use client";

import { Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useInterval } from "@/hooks/effects/use-interval";
import { cancelAdminEvalRunAction } from "@/lib/actions/admin-evals/action";

const REFRESH_MS = 15_000;

/** While a run is queued or running, the page reads it again every 15 seconds. */
export function EvalRunRefresh() {
  const router = useRouter();
  // Syncs with the browser's clock: an external system, not derived state.
  useInterval(() => router.refresh(), REFRESH_MS);
  return null;
}

export function CancelEvalRunButton({ runId }: { runId: string }) {
  const t = useTranslations("App.Admin.Evals");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await cancelAdminEvalRunAction({ runId });
          if (!result.ok) {
            toast.error(result.error.message ?? t("cancelError"));
            return;
          }
          router.refresh();
        })
      }
    >
      <Square aria-hidden className="size-4" />
      {t("cancelRun")}
    </Button>
  );
}
