"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function WorkspaceGateRetry() {
  const t = useTranslations("WorkspaceGate");
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  function handleRetry() {
    setLoading(true);
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="primary"
      onClick={handleRetry}
      disabled={loading}
      data-workspace-gate-retry
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {t("retry")}
    </Button>
  );
}
