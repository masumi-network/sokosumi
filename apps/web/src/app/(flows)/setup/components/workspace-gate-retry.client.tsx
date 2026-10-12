"use client";

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
      loading={isPending}
      data-workspace-gate-retry
    >
      {t("retry")}
    </Button>
  );
}
