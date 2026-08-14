"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

export function WorkspaceGateRetry() {
  const t = useTranslations("WorkspaceGate");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="primary"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      data-workspace-gate-retry
    >
      {isPending && <Loader2 className="size-4 animate-spin" />}
      {t("retry")}
    </Button>
  );
}
